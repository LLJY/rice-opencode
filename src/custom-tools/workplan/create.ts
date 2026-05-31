import { promises as fs } from "node:fs";

import { tool } from "@opencode-ai/plugin";

import { workplanFindingSchema, workplanPhaseSchema } from "./schemas";
import {
  ensureWorkplanDirectory,
  formatOutput,
  normalizeFinding,
  normalizeId,
  normalizePhase,
  normalizePlanFile,
  normalizeSpecFiles,
  renderWorkplanMarkdown,
  resolveWorkspaceFile,
  resolveToolWorkspaceRoot,
  summarize,
  uniqueStrings,
  workplanMarkdownPath,
  workplanPath,
  writeWorkplanDocument,
  writeWorkplanMarkdown,
} from "./shared";
import { WORKPLAN_STATUSES } from "./types";
import type { WorkplanDocument } from "./types";

export const workplan_create = tool({
  description: "Create a structured workplan in .opencode/workplan with JSON metadata and a Markdown plan for persistent multi-step coordination across agents.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
    id: tool.schema.string().describe("Stable workplan id"),
    kind: tool.schema.string().default("general").describe("Workplan category such as software-engineering or project-manager"),
    title: tool.schema.string().optional().describe("Optional short title"),
    goal: tool.schema.string().describe("Primary outcome this workplan should achieve"),
    scope: tool.schema.array(tool.schema.string()).optional().describe("In-scope items"),
    nonGoals: tool.schema.array(tool.schema.string()).optional().describe("Explicit non-goals"),
    constraints: tool.schema.array(tool.schema.string()).optional().describe("Important constraints or guardrails"),
    relevantFiles: tool.schema.array(tool.schema.string()).optional().describe("Known relevant files or paths"),
    planFile: tool.schema.string().optional().describe("Optional Markdown plan path; defaults to .opencode/workplan/<id>.md"),
    planMarkdown: tool.schema.string().optional().describe("Optional initial Markdown content for the detailed plan file"),
    specFiles: tool.schema.array(tool.schema.string()).optional().describe("Architecture or specification files the work should follow"),
    phases: tool.schema.array(workplanPhaseSchema).optional().describe("Optional initial phases"),
    reviewFindings: tool.schema.array(workplanFindingSchema).optional().describe("Optional initial review findings"),
    notes: tool.schema.array(tool.schema.string()).optional().describe("Optional freeform notes"),
    status: tool.schema.enum(WORKPLAN_STATUSES).default("draft").describe("Initial workplan status"),
    overwrite: tool.schema.boolean().default(false).describe("Allow overwriting an existing workplan with the same id"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    const id = normalizeId(args.id);
    const kind = args.kind?.trim() || "general";
    const status = args.status ?? "draft";
    const overwrite = args.overwrite ?? false;
    const path = workplanPath(workspaceRoot, id);
    const planFile = normalizePlanFile(workspaceRoot, args.planFile ?? workplanMarkdownPath(workspaceRoot, id));
    const planPath = resolveWorkspaceFile(workspaceRoot, planFile);

    context.metadata({
      title: "Create workplan",
      metadata: { workspaceRoot, id, kind, overwrite },
    });

    await ensureWorkplanDirectory(workspaceRoot);

    if (!overwrite) {
      try {
        await fs.access(path);
        throw new Error(`Workplan already exists: ${path}`);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }

      try {
        await fs.access(planPath);
        throw new Error(`Plan file already exists: ${planPath}`);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
    }

    const now = new Date().toISOString();
    const usedPhaseIds = new Set<string>();
    const document: WorkplanDocument = {
      schemaVersion: 2,
      id,
      kind,
      title: args.title?.trim() || null,
      goal: args.goal.trim(),
      scope: uniqueStrings(args.scope),
      nonGoals: uniqueStrings(args.nonGoals),
      constraints: uniqueStrings(args.constraints),
      relevantFiles: uniqueStrings(args.relevantFiles),
      planFile,
      specFiles: normalizeSpecFiles(workspaceRoot, args.specFiles),
      phases: (args.phases ?? []).map((phase, index) => normalizePhase(phase, index, { usedPhaseIds })),
      reviewFindings: (args.reviewFindings ?? []).map(normalizeFinding),
      notes: uniqueStrings(args.notes),
      status,
      createdAt: now,
      updatedAt: now,
    };

    await writeWorkplanDocument(workspaceRoot, path, document);
    await writeWorkplanMarkdown(workspaceRoot, planPath, args.planMarkdown ?? renderWorkplanMarkdown(document));

    return formatOutput({ created: true, path, planPath, workplan: summarize(document) });
  },
});

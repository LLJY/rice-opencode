import { promises as fs } from "node:fs";

import { tool } from "@opencode-ai/plugin";

import {
  workplanFindingSchema,
  workplanPhaseInsertSchema,
  workplanPhasePatchSchema,
  workplanPhaseSchema,
  workplanStepInsertSchema,
  workplanStepPatchSchema,
} from "./schemas";
import {
  assertUniqueWorkplanIds,
  formatOutput,
  getPhaseById,
  getStepById,
  normalizeFinding,
  normalizePhase,
  normalizePlanFile,
  normalizeStep,
  normalizeSpecFiles,
  readOptionalFile,
  readWorkplanDocument,
  renderWorkplanMarkdown,
  resolveLinkedPlanPath,
  resolveToolWorkspaceRoot,
  summarize,
  uniqueStrings,
  writeWorkplanDocument,
  writeWorkplanMarkdown,
} from "./shared";
import { WORKPLAN_STATUSES } from "./types";

export const workplan_update = tool({
  description: "Update a structured workplan's JSON metadata, linked Markdown plan path, files, findings, or targeted phase and step fields without rewriting the whole document manually.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
    id: tool.schema.string().describe("Workplan id"),
    title: tool.schema.string().optional().describe("Replace the workplan title"),
    goal: tool.schema.string().optional().describe("Replace the workplan goal"),
    status: tool.schema.enum(WORKPLAN_STATUSES).optional().describe("Replace the overall workplan status"),
    scope: tool.schema.array(tool.schema.string()).optional().describe("Replace the scope list"),
    nonGoals: tool.schema.array(tool.schema.string()).optional().describe("Replace the non-goals list"),
    constraints: tool.schema.array(tool.schema.string()).optional().describe("Replace the constraints list"),
    planFile: tool.schema.string().optional().describe("Replace the linked Markdown plan path"),
    planMarkdown: tool.schema.string().optional().describe("Replace the full Markdown content for the linked plan file"),
    specFiles: tool.schema.array(tool.schema.string()).optional().describe("Replace the full spec file list"),
    reviewFindings: tool.schema.array(workplanFindingSchema).optional().describe("Replace the full review findings list"),
    phases: tool.schema.array(workplanPhaseSchema).optional().describe("Replace the full phase list"),
    updatePhases: tool.schema.array(workplanPhasePatchSchema).optional().describe("Patch existing phases by phase id"),
    addPhases: tool.schema.array(workplanPhaseInsertSchema).optional().describe("Append or insert new phases with stable ids"),
    updateSteps: tool.schema.array(workplanStepPatchSchema).optional().describe("Patch existing steps by phase id and step id"),
    addSteps: tool.schema.array(workplanStepInsertSchema).optional().describe("Append or insert new steps with stable ids"),
    addRelevantFiles: tool.schema.array(tool.schema.string()).optional().describe("Append relevant files and de-duplicate"),
    addSpecFiles: tool.schema.array(tool.schema.string()).optional().describe("Append spec files and de-duplicate"),
    removeSpecFiles: tool.schema.array(tool.schema.string()).optional().describe("Remove spec files from the current list"),
    addReviewFindings: tool.schema.array(workplanFindingSchema).optional().describe("Append review findings"),
    appendNotes: tool.schema.array(tool.schema.string()).optional().describe("Append freeform notes"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    const { path, document } = await readWorkplanDocument(workspaceRoot, args.id);
    const previousDocument = JSON.parse(JSON.stringify(document)) as typeof document;
    const previousPlanPath = resolveLinkedPlanPath(workspaceRoot, document);
    const previousPlanContent = await readOptionalFile(workspaceRoot, previousPlanPath, "Plan file");
    const previousPlanWasGenerated = previousPlanContent !== null && previousPlanContent === renderWorkplanMarkdown(previousDocument);

    context.metadata({
      title: "Update workplan",
      metadata: {
        workspaceRoot,
        id: document.id,
        updateFields: Object.keys(args).filter((key) => !["workspaceRoot", "id"].includes(key)),
      },
    });

    const usesTargetedIds = Boolean(
      args.updatePhases?.length || args.updateSteps?.length || args.addSteps?.length || args.addPhases?.some((entry) => entry.afterPhaseId),
    );
    if (usesTargetedIds) assertUniqueWorkplanIds(document);

    if (args.title !== undefined) document.title = args.title.trim() || null;
    if (args.goal !== undefined) document.goal = args.goal.trim();
    if (args.status !== undefined) document.status = args.status;
    if (args.scope !== undefined) document.scope = uniqueStrings(args.scope);
    if (args.nonGoals !== undefined) document.nonGoals = uniqueStrings(args.nonGoals);
    if (args.constraints !== undefined) document.constraints = uniqueStrings(args.constraints);
    if (args.planFile !== undefined) document.planFile = normalizePlanFile(workspaceRoot, args.planFile);
    if (args.specFiles !== undefined) document.specFiles = normalizeSpecFiles(workspaceRoot, args.specFiles);
    if (args.reviewFindings !== undefined) document.reviewFindings = args.reviewFindings.map(normalizeFinding);
    if (args.phases !== undefined) {
      const usedPhaseIds = new Set<string>();
      document.phases = args.phases.map((phase, index) => normalizePhase(phase, index, { usedPhaseIds }));
    }
    if (args.updatePhases?.length) {
      for (const patch of args.updatePhases) {
        const { phase } = getPhaseById(document, patch.phaseId);
        if (patch.title !== undefined) {
          const title = patch.title.trim();
          if (!title) throw new Error(`Phase ${phase.id} title cannot be empty`);
          phase.title = title;
        }
        if (patch.status !== undefined) phase.status = patch.status;
      }
    }
    if (args.addPhases?.length) {
      const usedPhaseIds = new Set(document.phases.map((phase) => phase.id));
      const insertionOffsets = new Map<string, number>();
      for (const insertion of args.addPhases) {
        const phase = normalizePhase(insertion.phase, document.phases.length, { usedPhaseIds });
        if (!insertion.afterPhaseId) {
          document.phases.push(phase);
          continue;
        }

        const { phase: anchorPhase, index } = getPhaseById(document, insertion.afterPhaseId);
        const offset = insertionOffsets.get(anchorPhase.id) ?? 0;
        document.phases.splice(index + 1 + offset, 0, phase);
        insertionOffsets.set(anchorPhase.id, offset + 1);
      }
    }
    if (args.updateSteps?.length) {
      for (const patch of args.updateSteps) {
        const { phase } = getPhaseById(document, patch.phaseId);
        const { step } = getStepById(phase, patch.stepId);

        if (patch.title !== undefined) {
          const title = patch.title.trim();
          if (!title) throw new Error(`Step ${step.id} title cannot be empty`);
          step.title = title;
        }
        if (patch.target !== undefined) step.target = patch.target.trim() || undefined;
        if (patch.action !== undefined) step.action = patch.action.trim() || undefined;
        if (patch.validation !== undefined) step.validation = patch.validation.trim() || undefined;
        if (patch.status !== undefined) step.status = patch.status;
      }
    }
    if (args.addSteps?.length) {
      const insertionOffsets = new Map<string, number>();
      for (const insertion of args.addSteps) {
        const { phase } = getPhaseById(document, insertion.phaseId);
        const usedStepIds = new Set(phase.steps.map((step) => step.id));
        const step = normalizeStep(insertion.step, phase.steps.length, { usedIds: usedStepIds });
        if (!insertion.afterStepId) {
          phase.steps.push(step);
          continue;
        }

        const { step: anchorStep, index } = getStepById(phase, insertion.afterStepId);
        const insertionKey = `${phase.id}:${anchorStep.id}`;
        const offset = insertionOffsets.get(insertionKey) ?? 0;
        phase.steps.splice(index + 1 + offset, 0, step);
        insertionOffsets.set(insertionKey, offset + 1);
      }
    }
    if (args.addRelevantFiles?.length) {
      document.relevantFiles = uniqueStrings([...document.relevantFiles, ...args.addRelevantFiles]);
    }
    if (args.addSpecFiles?.length) {
      document.specFiles = normalizeSpecFiles(workspaceRoot, [...document.specFiles, ...args.addSpecFiles]);
    }
    if (args.removeSpecFiles?.length) {
      const removals = new Set(normalizeSpecFiles(workspaceRoot, args.removeSpecFiles));
      document.specFiles = document.specFiles.filter((specFile) => !removals.has(specFile));
    }
    if (args.addReviewFindings?.length) {
      document.reviewFindings.push(...args.addReviewFindings.map(normalizeFinding));
    }
    if (args.appendNotes?.length) {
      document.notes = uniqueStrings([...document.notes, ...args.appendNotes]);
    }

    document.updatedAt = new Date().toISOString();
    const planPath = resolveLinkedPlanPath(workspaceRoot, document);

    if (args.planFile !== undefined && planPath !== previousPlanPath) {
      try {
        await fs.access(planPath);
        throw new Error(`Refusing to overwrite existing plan file: ${document.planFile}`);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
    }

    const refreshGeneratedMarkdownFields = new Set([
      "title",
      "goal",
      "status",
      "scope",
      "nonGoals",
      "constraints",
      "specFiles",
      "reviewFindings",
      "phases",
      "updatePhases",
      "addPhases",
      "updateSteps",
      "addSteps",
      "addRelevantFiles",
      "addSpecFiles",
      "removeSpecFiles",
      "addReviewFindings",
      "appendNotes",
    ]);
    const shouldRefreshGeneratedMarkdown =
      args.planMarkdown === undefined &&
      args.planFile === undefined &&
      previousPlanWasGenerated &&
      Object.keys(args).some((key) => refreshGeneratedMarkdownFields.has(key));

    if (args.planMarkdown !== undefined) {
      await writeWorkplanMarkdown(workspaceRoot, planPath, args.planMarkdown);
    } else if (args.planFile !== undefined) {
      await writeWorkplanMarkdown(workspaceRoot, planPath, previousPlanWasGenerated ? renderWorkplanMarkdown(document) : previousPlanContent ?? renderWorkplanMarkdown(document));
    } else if (shouldRefreshGeneratedMarkdown) {
      await writeWorkplanMarkdown(workspaceRoot, planPath, renderWorkplanMarkdown(document));
    }

    await writeWorkplanDocument(workspaceRoot, path, document);
    return formatOutput({ updated: true, path, planPath, workplan: summarize(document) });
  },
});

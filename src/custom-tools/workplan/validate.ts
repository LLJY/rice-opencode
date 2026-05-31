import { promises as fs } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { tool } from "@opencode-ai/plugin";

import {
  formatOutput,
  isWithinWorkspaceRoot,
  readOptionalFile,
  readWorkplanDocument,
  resolveLinkedPlanPath,
  resolveToolWorkspaceRoot,
  summarize,
} from "./shared";

export const workplan_validate = tool({
  description: "Validate a structured workplan's JSON metadata, linked Markdown plan, and spec files before handing it to other agents.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
    id: tool.schema.string().describe("Workplan id"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    const { path, document } = await readWorkplanDocument(workspaceRoot, args.id);
    const planPath = resolveLinkedPlanPath(workspaceRoot, document);

    context.metadata({
      title: "Validate workplan",
      metadata: { workspaceRoot, id: document.id },
    });

    const issues: string[] = [];
    const phaseIds = new Set<string>();
    const realWorkspaceRoot = await fs.realpath(workspaceRoot).catch(() => resolve(workspaceRoot));

    if (!document.goal.trim()) issues.push("Goal is empty");
    if (!document.planFile.trim()) issues.push("Plan file is empty");
    if (document.phases.length === 0) issues.push("No phases defined");

    for (const phase of document.phases) {
      if (phaseIds.has(phase.id)) issues.push(`Duplicate phase id: ${phase.id}`);
      phaseIds.add(phase.id);

      if (phase.steps.length === 0) {
        issues.push(`Phase ${phase.id} has no steps`);
        continue;
      }

      const stepIds = new Set<string>();
      for (const step of phase.steps) {
        if (stepIds.has(step.id)) issues.push(`Duplicate step id in phase ${phase.id}: ${step.id}`);
        stepIds.add(step.id);
        if (!step.action?.trim()) issues.push(`Step ${phase.id}/${step.id} is missing an action`);
        if (!step.validation?.trim()) issues.push(`Step ${phase.id}/${step.id} is missing validation`);
      }
    }

    if (!document.planFile.endsWith(".md")) {
      issues.push(`Plan file should be Markdown: ${document.planFile}`);
    }

    if (!isWithinWorkspaceRoot(workspaceRoot, planPath)) {
      issues.push(`Plan file must stay inside workspace root: ${document.planFile}`);
    } else {
      try {
        const linkStats = await fs.lstat(planPath);
        if (linkStats.isSymbolicLink()) {
          issues.push(`Plan file must not be a symlink: ${document.planFile}`);
        } else {
          const realPlanPath = await fs.realpath(planPath);
          if (!isWithinWorkspaceRoot(realWorkspaceRoot, realPlanPath)) {
            issues.push(`Plan file resolves outside workspace root: ${document.planFile}`);
          }

          const stats = await fs.stat(planPath);
          if (!stats.isFile()) {
            issues.push(`Plan path is not a file: ${document.planFile}`);
          } else {
            const planContent = await readOptionalFile(workspaceRoot, planPath, "Plan file");
            if (!planContent?.trim()) issues.push(`Plan file is empty: ${document.planFile}`);
          }
        }
      } catch {
        issues.push(`Plan file not found: ${document.planFile}`);
      }
    }

    for (const specFile of document.specFiles) {
      const specPath = isAbsolute(specFile) ? resolve(specFile) : resolve(workspaceRoot, specFile);

      if (!isWithinWorkspaceRoot(workspaceRoot, specPath)) {
        issues.push(`Spec file must stay inside workspace root: ${specFile}`);
        continue;
      }

      try {
        const linkStats = await fs.lstat(specPath);
        if (linkStats.isSymbolicLink()) {
          issues.push(`Spec file must not be a symlink: ${specFile}`);
          continue;
        }

        const realSpecPath = await fs.realpath(specPath);
        if (!isWithinWorkspaceRoot(realWorkspaceRoot, realSpecPath)) {
          issues.push(`Spec file resolves outside workspace root: ${specFile}`);
          continue;
        }

        const stats = await fs.stat(specPath);
        if (!stats.isFile()) issues.push(`Spec path is not a file: ${specFile}`);
      } catch {
        issues.push(`Spec file not found: ${specFile}`);
      }
    }

    return formatOutput({ path, planPath, valid: issues.length === 0, issueCount: issues.length, issues, workplan: summarize(document) });
  },
});

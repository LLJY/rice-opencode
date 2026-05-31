import { tool } from "@opencode-ai/plugin";

import {
  assertUniqueWorkplanIds,
  formatOutput,
  phaseMarker,
  readOptionalFile,
  readWorkplanDocument,
  resolveLinkedPlanPath,
  resolveToolWorkspaceRoot,
  stepMarker,
  summarize,
} from "./shared";

export const workplan_inspect = tool({
  description: "Inspect a structured workplan's stable phase and step ids without returning the full Markdown plan content.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
    id: tool.schema.string().describe("Workplan id"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    const { path, document } = await readWorkplanDocument(workspaceRoot, args.id);
    assertUniqueWorkplanIds(document);
    const planPath = resolveLinkedPlanPath(workspaceRoot, document);
    const planExists = (await readOptionalFile(workspaceRoot, planPath, "Plan file")) !== null;

    context.metadata({
      title: "Inspect workplan",
      metadata: { workspaceRoot, id: document.id },
    });

    return formatOutput({
      path,
      workplan: summarize(document),
      plan: {
        path: planPath,
        exists: planExists,
      },
      phases: document.phases.map((phase, phaseIndex) => ({
        id: phase.id,
        title: phase.title,
        status: phase.status,
        index: phaseIndex,
        indexLabel: `${phaseIndex + 1}`,
        stepCount: phase.steps.length,
        markdownMarker: phaseMarker(phase.id),
      })),
      steps: document.phases.flatMap((phase, phaseIndex) =>
        phase.steps.map((step, stepIndex) => ({
          phaseId: phase.id,
          phaseTitle: phase.title,
          id: step.id,
          title: step.title,
          status: step.status,
          target: step.target ?? null,
          index: stepIndex,
          indexPath: `${phaseIndex + 1}.${stepIndex + 1}`,
          markdownMarker: stepMarker(step.id),
        })),
      ),
    });
  },
});

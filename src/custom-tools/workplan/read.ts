import { tool } from "@opencode-ai/plugin";

import { formatOutput, readOptionalFile, readWorkplanDocument, resolveLinkedPlanPath, resolveToolWorkspaceRoot } from "./shared";

export const workplan_read = tool({
  description: "Read one structured workplan from .opencode/workplan, including its linked Markdown plan when present.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
    id: tool.schema.string().describe("Workplan id"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    const { path, document } = await readWorkplanDocument(workspaceRoot, args.id);
    const planPath = resolveLinkedPlanPath(workspaceRoot, document);
    const planContent = await readOptionalFile(workspaceRoot, planPath, "Plan file");

    context.metadata({
      title: "Read workplan",
      metadata: { workspaceRoot, id: document.id },
    });

    return formatOutput({
      path,
      workplan: document,
      plan: {
        path: planPath,
        exists: planContent !== null,
        content: planContent,
      },
    });
  },
});

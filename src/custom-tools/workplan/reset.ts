import { tool } from "@opencode-ai/plugin";

import {
  formatOutput,
  readWorkplanDocument,
  renderWorkplanMarkdown,
  resolveLinkedPlanPath,
  resolveToolWorkspaceRoot,
  summarize,
  writeWorkplanDocument,
  writeWorkplanMarkdown,
} from "./shared";

export const workplan_reset = tool({
  description: "Reset a structured workplan back to draft planning state or regenerate its Markdown from the current JSON metadata.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
    id: tool.schema.string().describe("Workplan id"),
    mode: tool.schema.enum(["draft", "markdown-only"]).default("draft").describe("Reset planning state to a fresh draft, or only regenerate the linked Markdown plan"),
    preserveNotes: tool.schema.boolean().default(false).describe("Keep existing notes when mode is draft"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    const { path, document } = await readWorkplanDocument(workspaceRoot, args.id);
    const planPath = resolveLinkedPlanPath(workspaceRoot, document);
    const mode = args.mode ?? "draft";
    const preserveNotes = args.preserveNotes ?? false;

    context.metadata({
      title: "Reset workplan",
      metadata: { workspaceRoot, id: document.id, mode, preserveNotes },
    });

    if (mode === "draft") {
      document.phases = [];
      document.reviewFindings = [];
      if (!preserveNotes) document.notes = [];
      document.status = "draft";
      document.updatedAt = new Date().toISOString();
      await writeWorkplanDocument(workspaceRoot, path, document);
    }

    await writeWorkplanMarkdown(workspaceRoot, planPath, renderWorkplanMarkdown(document));
    return formatOutput({ reset: true, mode, path, planPath, workplan: summarize(document) });
  },
});

import { promises as fs } from "node:fs";
import { join } from "node:path";

import { tool } from "@opencode-ai/plugin";

import { assertSafePathAccess, formatOutput, resolveToolWorkspaceRoot, summarize, workplanDirectory } from "./shared";
import type { DirectoryLikeEntry, WorkplanDocument } from "./types";

export const workplan_list = tool({
  description: "List available structured workplans in .opencode/workplan for the current workspace.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    const directory = workplanDirectory(workspaceRoot);

    context.metadata({
      title: "List workplans",
      metadata: { workspaceRoot },
    });

    try {
      await assertSafePathAccess(workspaceRoot, directory, "Workplan directory");
      const entries = (await fs.readdir(directory, { withFileTypes: true })) as DirectoryLikeEntry[];
      const plans = await Promise.all(
        entries
          .filter((entry: DirectoryLikeEntry) => entry.name.endsWith(".json"))
          .map(async (entry: DirectoryLikeEntry) => {
            const path = join(directory, entry.name);
            await assertSafePathAccess(workspaceRoot, path, "Workplan file");
            if (!entry.isFile()) throw new Error(`Workplan path is not a file: ${path}`);
            const raw = await fs.readFile(path, "utf8");
            return summarize(JSON.parse(raw) as WorkplanDocument);
          }),
      );

      plans.sort((a: ReturnType<typeof summarize>, b: ReturnType<typeof summarize>) => a.id.localeCompare(b.id));
      return formatOutput({ workspaceRoot, directory, count: plans.length, workplans: plans });
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return formatOutput({ workspaceRoot, directory, count: 0, workplans: [] });
      }
      throw error;
    }
  },
});

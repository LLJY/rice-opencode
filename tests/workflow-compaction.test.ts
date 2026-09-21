import { describe, expect, it } from "bun:test";
import {
  WorkflowCompactionPlugin,
  WORKFLOW_COMPACTION_CONTEXT,
} from "../plugins/workflow-compaction";

const pluginInput = {
  client: {} as never,
  project: {} as never,
  directory: "/tmp/project",
  worktree: "/tmp/project",
  experimental_workspace: { register() {} },
  serverUrl: new URL("http://localhost"),
  $: {} as never,
};

describe("WorkflowCompactionPlugin", () => {
  it("adds workflow continuity without replacing the default prompt", async () => {
    const hooks = await WorkflowCompactionPlugin(pluginInput);
    const output = { context: ["existing"] };

    await hooks["experimental.session.compacting"]?.(
      { sessionID: "session-1" },
      output,
    );

    expect(output.context).toEqual(["existing", WORKFLOW_COMPACTION_CONTEXT]);
    expect("prompt" in output).toBe(false);
  });

  it("explicitly amends OpenCode's exact output template", () => {
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain("IMPORTANT TEMPLATE AMENDMENT");
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain(
      "The exact Markdown structure above is amended by this instruction.",
    );
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain(
      "immediately after the `## Relevant Files` section",
    );
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain("### Workflow Status");
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain(
      '- Continuation requirement: [workflow-plan: "Load the workflow-plan skill before continuing." | workflow-execute: "Load the workflow-execute skill before continuing."]',
    );
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain(
      "Do not infer an active workflow from an old, completed, cancelled, proposed, or merely discussed workplan.",
    );
  });
});

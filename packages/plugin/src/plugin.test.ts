import { describe, expect, it } from "bun:test";
import { RicePlugin, WORKFLOW_COMPACTION_CONTEXT } from "./index";

const pluginInput = {
  client: {} as never,
  project: {} as never,
  directory: "/tmp/project",
  worktree: "/tmp/project",
  experimental_workspace: { register() {} },
  serverUrl: new URL("http://localhost"),
  $: {} as never,
};

describe("RicePlugin", () => {
  it("registers the complete workplan toolset", async () => {
    const hooks = await RicePlugin(pluginInput);

    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([
      "workplan_create",
      "workplan_inspect",
      "workplan_list",
      "workplan_patch",
      "workplan_read",
      "workplan_reset",
      "workplan_update",
      "workplan_validate",
    ]);
  });

  it("registers its bundled skills directory once", async () => {
    const hooks = await RicePlugin(pluginInput);
    const config = { skills: { paths: ["/existing/skills"] } } as never;

    await hooks.config?.(config);
    await hooks.config?.(config);

    const paths = (config as { skills: { paths: string[] } }).skills.paths;
    expect(paths[0]).toBe("/existing/skills");
    expect(paths).toHaveLength(2);
    expect(paths[1]).not.toBe(paths[0]);
    expect(new Set(paths).size).toBe(2);
  });

  it("appends the workflow status contract without replacing the default compaction prompt", async () => {
    const hooks = await RicePlugin(pluginInput);
    const output = { context: ["existing context"] };

    await hooks["experimental.session.compacting"]?.(
      { sessionID: "session-1" },
      output,
    );

    expect(output.context).toEqual(["existing context", WORKFLOW_COMPACTION_CONTEXT]);
    expect("prompt" in output).toBe(false);
  });

  it("ships the concise conditional workflow appendix", () => {
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain(
      "Append this section only if an active workplan is currently being planned or executed.",
    );
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain("### Workflow Status");
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain("- Mode: workflow-plan | workflow-execute");
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain("- Workplan path: [exact path]");
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain("- Current step: [exact current step and status]");
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain("- Plan-checker ran: yes | no");
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain(
      '- Continuation requirement: [workflow-plan: "Load the workflow-plan skill before continuing." | workflow-execute: "Load the workflow-execute skill before continuing."]',
    );
    expect(WORKFLOW_COMPACTION_CONTEXT).toContain(
      "Do not infer an active workflow from an old, completed, cancelled, proposed, or merely discussed workplan.",
    );
  });
});

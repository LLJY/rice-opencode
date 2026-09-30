import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { parseOption } from "@opencode/core/config/markdown";
import { normalize } from "@opencode/core/config/normalize";
import { Agent } from "@opencode/schema/agent";
import { Info as ConfigAgentInfo } from "@opencode/schema/config/agent";
import { Model } from "@opencode/schema/model";
import { Schema } from "effect";
import { Host } from "@opencode/plugin/host";
import { Plugin } from "@opencode/plugin";
import type { Info as NativeSkillInfo } from "@opencode/schema/skill";
import type { Info as NativeToolInfo, ToolContext as NativeToolContext } from "@opencode/plugin/promise/tool";
import type { AgentEditor } from "@opencode/plugin/promise/agent";
import type { CommandDefinition, CommandEditor } from "@opencode/plugin/promise/command";
import type { SkillEditor } from "@opencode/plugin/promise/skill";
import type { ToolEditor } from "@opencode/plugin/promise/tool";

import RicePluginV2 from "./v2";

type TestTool = {
  name: string;
  input: { parse(value: unknown): unknown };
  execute(input: unknown, context: NativeToolContext): Promise<{ content?: string; metadata?: Record<string, unknown> }>;
  options?: { permission?: string };
};

type ReviewPrompt = {
  text: string;
  files?: unknown[];
  agents?: unknown[];
  skills?: unknown[];
  metadata?: Record<string, unknown>;
};

type TestCommand = {
  name: string;
  description?: string;
  execute(input: { sessionID: string; prompt: ReviewPrompt; delivery: "steer" | "queue" }): Promise<void>;
};

type TestAgent = {
  id: string;
  name: string;
  model?: { id: string; providerID: string; variant?: string };
  request: { settings: Record<string, unknown>; headers: Record<string, string>; body: Record<string, unknown> };
  system?: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  color?: string;
  steps?: number;
  permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>;
};

const agentNames = [
  "build",
  "chat",
  "code-checker",
  "code-writer",
  "document-proofreader",
  "explore",
  "plan",
  "plan-checker",
  "researcher",
  "swe",
];
const skillNames = ["agent-use", "frontend-design", "git-commit", "shell-strategy", "workflow-execute", "workflow-plan"];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageDirectory = resolve(repositoryRoot, "packages/plugin");
const distDirectory = resolve(packageDirectory, "dist");
const roots: string[] = [];

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempDirectory(prefix = "rice-plugin-v2-"): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

function agentDefault(id: string): TestAgent {
  return Agent.Info.default(Agent.ID.make(id)) as unknown as TestAgent;
}

function seededAgents(): TestAgent[] {
  const swe = agentDefault("swe");
  swe.system = "stale swe prompt";
  swe.model = { id: "old-model", providerID: "old-provider", variant: "old" };
  swe.steps = 91;
  swe.color = "#123456";
  swe.request = { settings: { oldSetting: true }, headers: { "x-old": "header" }, body: { custom: "old" } };
  swe.permissions.push({ action: "custom", resource: "old-rule", effect: "deny" });

  const build = agentDefault("build");
  build.system = "previous build prompt";
  build.request = { settings: { oldSetting: true }, headers: { "x-old": "header" }, body: { custom: "old" } };
  build.permissions.push({ action: "*", resource: "*", effect: "deny" });

  return [swe, build, agentDefault("unrelated")];
}

function makePluginContext(
  sessions: Record<string, { directory: string; subpath?: string }>,
  options: Record<string, unknown> = {},
  existingSkills: Array<{ id: string; [key: string]: unknown }> = [],
  existingAgents: TestAgent[] = [],
) {
  const tools = new Map<string, NativeToolInfo>();
  const skills = new Map(existingSkills.map((skill) => [skill.id, skill]));
  const agents = new Map<string, TestAgent>(existingAgents.map((agent) => [agent.id, agent]));
  const commands = new Map<string, TestCommand>();
  const initialAgents = new Map([...agents].map(([id, agent]) => [id, structuredClone(agent)]));
  const switchedAgents: Array<{ sessionID: string; agent: string }> = [];
  const switchedModels: Array<{ sessionID: string; model: NonNullable<TestAgent["model"]> }> = [];
  const sessionModels = new Map<string, TestAgent["model"]>();
  const promptModels: Array<TestAgent["model"]> = [];
  const prompts: Record<string, unknown>[] = [];
  let defaultAgent = "host-default";
  let defaultChanges = 0;
  let sessionLookups = 0;
  let toolTransforms = 0;
  let skillTransforms = 0;
  let agentTransforms = 0;
  let commandTransforms = 0;

  const context = {
    options,
    session: {
      async get({ sessionID }: { sessionID: string }) {
        sessionLookups += 1;
        const session = sessions[sessionID];
        if (!session) throw new Error(`Unknown session: ${sessionID}`);
        return { location: { directory: session.directory }, subpath: session.subpath };
      },
      async switchAgent(input: { sessionID: string; agent: string }) {
        switchedAgents.push(input);
      },
      async switchModel(input: { sessionID: string; model: NonNullable<TestAgent["model"]> }) {
        switchedModels.push(input);
        sessionModels.set(input.sessionID, input.model);
      },
      async prompt(input: Record<string, unknown>) {
        promptModels.push(sessionModels.get(input.sessionID as string));
        prompts.push(input);
      },
    },
    tool: {
      async transform(callback: (editor: ToolEditor) => void) {
        toolTransforms += 1;
        callback({ add: (tool: NativeToolInfo) => tools.set(tool.name, tool) } as unknown as ToolEditor);
      },
    },
    skill: {
      async transform(callback: (editor: SkillEditor) => void) {
        skillTransforms += 1;
        callback({
          get: (id: string) => skills.get(id) as never,
          add: (skill: NativeSkillInfo) => skills.set(skill.id, skill as never),
        } as unknown as SkillEditor);
      },
    },
    agent: {
      async get({ agentID }: { agentID: string }) {
        const agent = agents.get(agentID);
        if (!agent) throw new Error(`Unknown agent: ${agentID}`);
        return { data: agent };
      },
      async transform(callback: (editor: AgentEditor) => void) {
        agentTransforms += 1;
        callback({
          list: () => [...agents.values()] as never,
          get: (id: string) => agents.get(id) as never,
          default(id: string | undefined) {
            defaultChanges += 1;
            defaultAgent = id ?? "";
          },
          update(id: string, update: (agent: never) => void) {
            const agent = agents.get(id) ?? agentDefault(id);
            update(agent as never);
            agents.set(id, agent);
          },
          remove: (id: string) => agents.delete(id),
        } as unknown as AgentEditor);
      },
    },
    command: {
      async transform(callback: (editor: CommandEditor) => void) {
        commandTransforms += 1;
        callback({ add: (command: CommandDefinition) => commands.set(command.name, command as unknown as TestCommand) } as unknown as CommandEditor);
      },
    },
  } as unknown as Plugin.Context;

  return {
    context,
    tools,
    skills,
    agents,
    commands,
    initialAgents,
    switchedAgents,
    switchedModels,
    sessionModels,
    promptModels,
    prompts,
    get defaultAgent() { return defaultAgent; },
    get defaultChanges() { return defaultChanges; },
    get sessionLookups() { return sessionLookups; },
    get toolTransforms() { return toolTransforms; },
    get skillTransforms() { return skillTransforms; },
    get agentTransforms() { return agentTransforms; },
    get commandTransforms() { return commandTransforms; },
  };
}

function nativeContext(sessionID: string): NativeToolContext {
  return { sessionID, signal: new AbortController().signal, progress: async () => {} } as unknown as NativeToolContext;
}

function toolFor(tools: Map<string, NativeToolInfo>, name: string): TestTool {
  return tools.get(name) as unknown as TestTool;
}

async function execute(tool: TestTool, args: unknown, sessionID = "session") {
  return tool.execute(tool.input.parse(args), nativeContext(sessionID));
}

function sourceMarkdown(path: string) {
  const markdown = parseOption(readFileSync(path, "utf8"));
  if (!markdown) throw new Error(`Invalid Markdown frontmatter: ${path}`);
  return markdown;
}

function normalizedAgent(id: string) {
  const markdown = sourceMarkdown(join(repositoryRoot, "agents", `${id}.md`));
  const normalized = normalize({ agent: { [id]: { ...markdown.data, prompt: markdown.content } } });
  if (normalized.type !== "normalized") throw new Error(`Cannot normalize ${id}`);
  expect(normalized.diagnostics).toEqual([]);
  const config = Schema.decodeUnknownSync(ConfigAgentInfo)(
    (normalized.encoded.agents as Record<string, unknown>)[id],
  );
  return { markdown, config };
}

function copiedFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? copiedFiles(path).map((child) => join(entry.name, child)) : [entry.name];
  }).sort();
}

describe("RicePluginV2", () => {
  it("registers nine tools, six bundled skills, ten agents and review without replacing user skills", async () => {
    const root = tempDirectory();
    const userSkill = { id: "workflow-plan", name: "workflow-plan", content: "user content" };
    const host = makePluginContext({ session: { directory: root } }, {}, [userSkill], seededAgents());

    await RicePluginV2.setup(host.context);

    expect([...host.tools.keys()].sort()).toEqual([
      "viz_generate_image",
      "workplan_create",
      "workplan_inspect",
      "workplan_list",
      "workplan_patch",
      "workplan_read",
      "workplan_reset",
      "workplan_update",
      "workplan_validate",
    ]);
    expect(Object.keys(RicePluginV2).sort()).toEqual(["id", "setup"]);
    expect(RicePluginV2.id).toBe("@rice-opencode/plugin");
    expect([...host.skills.keys()].sort()).toEqual(skillNames);
    expect(host.skills.get("workflow-plan")).toBe(userSkill);
    expect([...host.agents.keys()].sort()).toEqual([...agentNames, "unrelated"].sort());
    expect([...host.commands.keys()]).toEqual(["review"]);
    expect(host.toolTransforms).toBe(1);
    expect(host.skillTransforms).toBe(1);
    expect(host.agentTransforms).toBe(1);
    expect(host.commandTransforms).toBe(1);
    expect(host.defaultAgent).toBe("host-default");
    expect(host.defaultChanges).toBe(0);
    expect(host.switchedAgents).toEqual([]);
    expect(host.switchedModels).toEqual([]);
    expect(host.prompts).toEqual([]);

    const skillHost = makePluginContext({ session: { directory: root } });
    await RicePluginV2.setup(skillHost.context);
    expect([...skillHost.skills.keys()].sort()).toEqual(skillNames);
    for (const name of skillNames) {
      const skill = skillHost.skills.get(name) as {
        id: string;
        name: string;
        description: string;
        path: string;
        content: string;
      };
      const sourceDirectory = join(repositoryRoot, "skills", name);
      const installedDirectory = join(distDirectory, "skills", name);
      const markdown = sourceMarkdown(join(sourceDirectory, "SKILL.md"));

      expect(skill.id).toBe(name);
      expect(skill.name).toBe(name);
      expect(skill.description).toBe(markdown.data.description);
      expect(skill.content).toBe(markdown.content);
      expect(skill.path).toBe(join(installedDirectory, "SKILL.md"));
      expect(copiedFiles(installedDirectory)).toEqual(copiedFiles(sourceDirectory));
      for (const file of copiedFiles(sourceDirectory)) {
        expect(readFileSync(join(installedDirectory, file))).toEqual(readFileSync(join(sourceDirectory, file)));
      }
    }
    expect((skillHost.skills.get("frontend-design") as unknown as { description: string }).description)
      .toBe("load this skill when doing any frontend related work or review.");
    expect(readdirSync(join(distDirectory, "agents")).sort()).toEqual(agentNames.map((name) => `${name}.md`).sort());
    for (const name of agentNames) {
      expect(readFileSync(join(distDirectory, "agents", `${name}.md`)))
        .toEqual(readFileSync(join(repositoryRoot, "agents", `${name}.md`)));
    }
    expect(readFileSync(join(distDirectory, "commands/review.md")))
      .toEqual(readFileSync(join(repositoryRoot, "commands/review.md")));
  });

  it("replaces matching agents, preserves prior permissions and defaults, and replays fresh asset clones", async () => {
    const root = tempDirectory();
    const host = makePluginContext({ session: { directory: root } }, {}, [], seededAgents());
    const unrelatedBefore = structuredClone(host.initialAgents.get("unrelated"));

    await RicePluginV2.setup(host.context);

    for (const id of agentNames) {
      const { markdown, config } = normalizedAgent(id);
      const actual = host.agents.get(id)!;
      const original = host.initialAgents.get(id) ?? agentDefault(id);
      const expectedModel = config.model === undefined
        ? undefined
        : Schema.decodeUnknownSync(Model.Ref)({
            id: config.model.model,
            providerID: config.model.providerID,
            ...(config.model.variant === undefined ? {} : { variant: config.model.variant }),
          });

      expect(actual.id).toBe(id);
      expect(actual.name).toBe(id);
      expect(actual.system).toBe(markdown.content);
      expect(actual.description).toBe(config.description);
      expect(actual.mode).toBe(config.mode ?? "primary");
      expect(actual.hidden).toBe(config.hidden ?? false);
      expect(actual.model).toEqual(expectedModel);
      expect(actual.color).toBe(config.color);
      expect(actual.steps).toBe(config.steps);
      expect(actual.request).toEqual({
        settings: {},
        headers: config.request?.headers ?? {},
        body: config.request?.body ?? {},
      });
      expect(actual.permissions).toEqual([...original.permissions, ...(config.permissions ?? [])]);
    }

    expect(host.agents.get("build")?.system).not.toBe("previous build prompt");
    expect(host.agents.get("build")?.permissions.at(-1)).toEqual({ action: "*", resource: "*", effect: "allow" });
    expect(host.agents.get("swe")?.model).toBeUndefined();
    expect(host.agents.get("swe")?.steps).toBeUndefined();
    expect(host.agents.get("swe")?.color).toBeUndefined();
    expect(host.agents.get("swe")?.request).toEqual({ settings: {}, headers: {}, body: { temperature: 0.2 } });
    expect(host.agents.get("unrelated")).toEqual(unrelatedBefore);
    expect(host.defaultAgent).toBe("host-default");
    expect(host.defaultChanges).toBe(0);

    const build = host.agents.get("build")!;
    build.request.body.poisoned = true;
    build.permissions.at(-1)!.resource = "poisoned";
    const replay = makePluginContext({ session: { directory: root } }, {}, [], seededAgents());
    await RicePluginV2.setup(replay.context);
    const replayBuild = replay.agents.get("build")!;
    const { config } = normalizedAgent("build");
    expect(replayBuild.request.body).toEqual(config.request?.body ?? {});
    expect(replayBuild.permissions.at(-1)).toEqual(config.permissions?.at(-1));
    expect(replay.defaultChanges).toBe(0);
  });

  it("runs /review in the invoking session with the stored body, arguments, attachments and delivery", async () => {
    const host = makePluginContext({});
    await RicePluginV2.setup(host.context);
    const command = host.commands.get("review")!;
    const markdown = sourceMarkdown(join(repositoryRoot, "commands/review.md"));
    const prompt: ReviewPrompt = {
      text: "focus on parser changes",
      files: [{ uri: "file:///repo/src/index.ts", name: "index.ts", mention: { start: 0, end: 1, text: "@index.ts" } }],
      agents: [{ name: "code-checker", mention: { start: 0, end: 13, text: "@code-checker" } }],
      skills: [{ id: "frontend-design", mention: { start: 0, end: 17, text: "$frontend-design" } }],
      metadata: { trace: "preserved" },
    };

    expect(command.description).toBe(markdown.data.description);
    host.sessionModels.set("review-session", { providerID: "other-provider", id: "other-model" });
    await command.execute({ sessionID: "review-session", prompt, delivery: "steer" });

    expect(host.switchedAgents).toEqual([{ sessionID: "review-session", agent: "build" }]);
    expect(host.switchedModels).toEqual([{ sessionID: "review-session", model: host.agents.get("build")!.model! }]);
    expect(host.promptModels[0]).toEqual(host.agents.get("build")!.model);
    expect(host.prompts).toEqual([{
      ...prompt,
      sessionID: "review-session",
      text: `${markdown.content}\n\n${prompt.text}`,
      delivery: "steer",
    }]);

    await command.execute({ sessionID: "empty-session", prompt: { text: "", metadata: { empty: true } }, delivery: "queue" });
    expect(host.switchedAgents.at(-1)).toEqual({ sessionID: "empty-session", agent: "build" });
    expect(host.prompts.at(-1)).toEqual({
      sessionID: "empty-session",
      text: markdown.content,
      metadata: { empty: true },
      delivery: "queue",
    });

    delete host.agents.get("build")!.model;
    const inheritedModel = { providerID: "host-provider", id: "host-model" };
    host.sessionModels.set("unpinned-session", inheritedModel);
    const previousModelSwitches = host.switchedModels.length;
    await command.execute({ sessionID: "unpinned-session", prompt: { text: "" }, delivery: "steer" });
    expect(host.switchedModels).toHaveLength(previousModelSwitches);
    expect(host.promptModels.at(-1)).toEqual(inheritedModel);
    expect(host.defaultChanges).toBe(0);
  });

  it("keeps Zod defaults and rejects invalid arguments", async () => {
    const host = makePluginContext({ session: { directory: tempDirectory() } });
    await RicePluginV2.setup(host.context);

    const create = toolFor(host.tools, "workplan_create");
    expect(create.input.parse({ id: "defaults", goal: "Goal" })).toMatchObject({
      id: "defaults",
      kind: "general",
      status: "draft",
      overwrite: false,
    });
    expect(toolFor(host.tools, "workplan_reset").input.parse({ id: "defaults" })).toMatchObject({
      mode: "draft",
      preserveNotes: false,
    });
    expect(toolFor(host.tools, "workplan_list").input.parse({})).toEqual({});
    expect(() => create.input.parse({ id: 123, goal: "Goal" })).toThrow();
    expect(() => toolFor(host.tools, "workplan_read").input.parse({ id: 2 })).toThrow();
  });

  it("requires explicit trust for every mutator and advertises action-level edit permission", async () => {
    const root = tempDirectory();
    const mutations = ["workplan_create", "workplan_update", "workplan_reset", "workplan_patch", "viz_generate_image"];

    for (const options of [{}, { trustedWorkspaceWrites: false }]) {
      const host = makePluginContext({ session: { directory: root } }, options);
      await RicePluginV2.setup(host.context);

      for (const name of mutations) {
        const tool = toolFor(host.tools, name);
        expect(tool.options?.permission).toBe("edit");
        const args = name === "viz_generate_image" ? { prompt: "cat", output_path: "image.png" } : {};
        await expect(tool.execute(args, nativeContext("session"))).rejects.toThrow("trustedWorkspaceWrites: true");
      }
      expect(host.sessionLookups).toBe(0);
    }

    const trusted = makePluginContext({ session: { directory: root } }, { trustedWorkspaceWrites: true });
    await RicePluginV2.setup(trusted.context);
    for (const name of ["workplan_inspect", "workplan_list", "workplan_read", "workplan_validate"]) {
      expect(toolFor(trusted.tools, name).options?.permission).toBeUndefined();
    }
  });

  it("uses each invocation's session worktree rather than process cwd", async () => {
    const first = tempDirectory("rice-first-");
    const second = tempDirectory("rice-second-");
    const host = makePluginContext({ first: { directory: first }, second: { directory: second } });
    await RicePluginV2.setup(host.context);
    const list = toolFor(host.tools, "workplan_list");

    const firstResult = await execute(list, {}, "first");
    const secondResult = await execute(list, {}, "second");

    expect(JSON.parse(firstResult.content!).workspaceRoot).toBe(first);
    expect(JSON.parse(secondResult.content!).workspaceRoot).toBe(second);
  });

  it("patches only the linked plan after trusted-path checks and returns merged metadata", async () => {
    const root = tempDirectory();
    const host = makePluginContext({ session: { directory: root } }, { trustedWorkspaceWrites: true });
    await RicePluginV2.setup(host.context);
    const create = toolFor(host.tools, "workplan_create");
    const patch = toolFor(host.tools, "workplan_patch");
    const planFile = ".opencode/workplan/trusted-patch.md";

    await execute(create, {
      id: "trusted-patch",
      goal: "Keep patch scope constrained",
      planMarkdown: "Old plan line\n",
    });

    const planPath = join(root, planFile);
    const beforeRejectedPatch = readFileSync(planPath, "utf8");
    const result = await execute(patch, {
      id: "trusted-patch",
      patchText: `*** Begin Patch\n*** Update File: ${planFile}\n@@\n-Old plan line\n+New plan line\n*** End Patch`,
    }) as { content?: string; metadata?: Record<string, unknown> };

    expect(result.content).toContain("Patched workplan trusted-patch plan file");
    expect(result.metadata).toMatchObject({
      title: "Patch workplan",
      workspaceRoot: root,
      id: "trusted-patch",
      planFile,
      patched: true,
    });
    expect(readFileSync(planPath, "utf8")).toBe("New plan line\n");
    expect(beforeRejectedPatch).toBe("Old plan line\n");

    const afterAcceptedPatch = readFileSync(planPath, "utf8");
    await expect(execute(patch, {
      id: "trusted-patch",
      patchText: `*** Begin Patch\n*** Update File: .opencode/workplan/other.md\n@@\n-New plan line\n+Rejected\n*** End Patch`,
    })).rejects.toThrow("Patch target must match linked planFile");
    expect(readFileSync(planPath, "utf8")).toBe(afterAcceptedPatch);
  });

  it("rejects symlinked linked plans without following them", async () => {
    const root = tempDirectory("rice-plan-root-");
    const outside = tempDirectory("rice-plan-outside-");
    const outsidePlan = join(outside, "outside.md");
    writeFileSync(outsidePlan, "outside stays unchanged\n");
    const host = makePluginContext({ session: { directory: root } }, { trustedWorkspaceWrites: true });
    await RicePluginV2.setup(host.context);

    await execute(toolFor(host.tools, "workplan_create"), {
      id: "linked",
      goal: "Check plan links",
      planMarkdown: "original\n",
    });

    const linkedPlan = join(root, ".opencode", "workplan", "linked.md");
    unlinkSync(linkedPlan);
    symlinkSync(outsidePlan, linkedPlan);

    await expect(execute(toolFor(host.tools, "workplan_read"), { id: "linked" })).rejects.toThrow("must not be a symlink");
    expect(readFileSync(outsidePlan, "utf8")).toBe("outside stays unchanged\n");
  });

  it("resolves the local package server entrypoint", () => {
    expect(fileURLToPath(Host.resolve({ directory: packageDirectory }).server!)).toBe(join(packageDirectory, "server.ts"));
  });
});

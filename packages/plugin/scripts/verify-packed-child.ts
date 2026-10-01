import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Host } from "@opencode/plugin/host";
import type { Plugin } from "@opencode/plugin";
import type { Info as NativeToolInfo, ToolContext as NativeToolContext } from "@opencode/plugin/promise/tool";

type ExpectedAgent = {
  originalBody: string;
  name: string;
  modelID?: string;
  providerID?: string;
  variant?: string;
  mode: string;
  request: Record<string, unknown>;
  permissions: Array<Record<string, unknown>>;
  description?: string;
  hidden: boolean;
  color?: string;
  steps?: number;
};

type Golden = {
  agents: Record<string, ExpectedAgent>;
  skills: Array<{ id: string; name: string; description: string; autoinvoke?: boolean; content: string; assetPath: string }>;
  reviewCommand: { name: string; description: string; agent: string; body: string };
  assetFiles: Record<string, string>;
};

type AgentState = {
  id: string;
  name: string;
  model?: { id: string; providerID: string; variant?: string };
  request: { settings: Record<string, unknown>; headers: Record<string, string>; body: Record<string, unknown> };
  system?: string;
  description?: string;
  mode: string;
  hidden: boolean;
  color?: string;
  steps?: number;
  permissions: Array<{ action: string; resource: string; effect: string }>;
};

type RegisteredTool = {
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

type RegisteredCommand = {
  name: string;
  description?: string;
  execute(input: { sessionID: string; prompt: ReviewPrompt; delivery: "steer" | "queue" }): Promise<void>;
};

const cleanRoom = process.cwd();
const require = createRequire(join(cleanRoom, "package.json"));
const golden = JSON.parse(await readFile(process.argv[2]!, "utf8")) as Golden;
const packageEntry = require.resolve("@rice-opencode/plugin");
const packageDirectory = dirname(dirname(packageEntry));
const inside = (root: string, path: string) => {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
};

assert.ok(inside(cleanRoom, packageDirectory), "Installed package escaped the clean room");
assert.throws(() => require.resolve("@opencode/core"));

const packageModule = await import(packageEntry) as { default: Plugin.Plugin; RicePluginV2?: Plugin.Plugin; RicePlugin?: unknown };
const plugin = packageModule.default;
assert.equal(plugin.id, "@rice-opencode/plugin");
assert.equal(typeof plugin.setup, "function");
assert.deepEqual(Object.keys(plugin).sort(), ["id", "setup"]);
assert.ok(!("RicePlugin" in packageModule), "A V1 callback export must not be present");

const server = Host.resolve({ directory: cleanRoom, name: "@rice-opencode/plugin" }).server;
assert.ok(server, "Packed native server entrypoint was not resolved");
assert.equal(fileURLToPath(server), packageEntry);
const nativeModule = await Host.load(server) as { default: Plugin.Plugin };
assert.strictEqual(nativeModule.default, plugin, "Default and Host-resolved imports must be the same bundle instance");
assert.equal(nativeModule.default.id, "@rice-opencode/plugin");
assert.equal(typeof nativeModule.default.setup, "function");
assert.deepEqual(Object.keys(nativeModule.default).sort(), ["id", "setup"]);

const packageManifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8")) as {
  exports: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
assert.deepEqual(Object.keys(packageManifest.exports).sort(), [".", "./server", "./v2"]);
assert.equal(packageManifest.exports["."], packageManifest.exports["./server"]);
assert.equal(packageManifest.exports["./server"], packageManifest.exports["./v2"]);
const dependencies = {
  ...packageManifest.dependencies,
  ...packageManifest.devDependencies,
  ...packageManifest.peerDependencies,
  ...packageManifest.optionalDependencies,
};
assert.equal(dependencies["@opencode/plugin"], "2.0.20");
assert.equal((packageManifest as unknown as { license: string }).license, "GPL-2.0-only");
assert.ok(!("@opencode-ai/plugin" in dependencies), "The V1 SDK must not be packaged");

async function filesUnder(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => entry.name !== "node_modules").map(async (entry) => {
    const path = join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(path, relativePath) : [relativePath];
  }));
  return files.flat().sort();
}

const payload = await filesUnder(packageDirectory);
const rootConfigs = payload.filter((path) => /^opencode.*\.jsonc?$/i.test(path.split("/").at(-1)!));
const sensitiveFiles = payload.filter((path) => {
  const name = path.split("/").at(-1)!;
  return /^\.env(?:$|[._-])|^\.npmrc$|(?:^|[._-])(?:credentials?|secrets?)(?:$|[._-])/i.test(name)
    || /\.(?:pem|key|p12|pfx|crt)$/i.test(name);
});
assert.deepEqual(rootConfigs, [], "OpenCode config files must not be packaged");
assert.deepEqual(sensitiveFiles, [], "Secret and environment files must not be packaged");
assert.match(await readFile(join(packageDirectory, "dist/LICENSE.md"), "utf8"), /GNU GENERAL PUBLIC LICENSE/);
assert.match(await readFile(join(packageDirectory, "dist/licenses/zod-LICENSE"), "utf8"), /Colin McDonnell/);
assert.ok(!payload.some((path) => path.includes("docs-first-coder")), "Deprecated docs-first-coder must not be packaged");

for (const [path, base64] of Object.entries(golden.assetFiles)) {
  const installedPath = resolve(packageDirectory, path);
  assert.ok(inside(packageDirectory, installedPath), `Asset path escaped package: ${path}`);
  assert.deepEqual(await readFile(installedPath), Buffer.from(base64, "base64"), `${path} changed in the package`);
}

for (const directory of ["skills", "agents", "commands"]) {
  const prefix = `dist/${directory}/`;
  const expected = Object.keys(golden.assetFiles)
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .sort();
  assert.deepEqual(await filesUnder(join(packageDirectory, "dist", directory)), expected, `Packaged ${directory} asset tree differs`);
}

const bundle = await readFile(join(packageDirectory, "dist/index.js"), "utf8");
assert.ok(!bundle.includes("@opencode-ai/plugin"), "Runtime bundle must not import the V1 SDK");
assert.ok(!bundle.includes("@opencode/core"), "Runtime bundle must not import Core");
assert.ok(!bundle.includes("docs-first-coder"), "Deprecated agent data must not be bundled");
assert.ok(!bundle.includes("experimental.session.compacting"), "V1 compaction hook must not be bundled");

const expectedToolNames = [
  "viz_generate_image",
  "workplan_create",
  "workplan_inspect",
  "workplan_list",
  "workplan_patch",
  "workplan_read",
  "workplan_reset",
  "workplan_update",
  "workplan_validate",
];
const toolNames = new Set(expectedToolNames);
let providerRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  providerRequests += 1;
  throw new Error("Provider requests are disabled in packed verification");
}) as unknown as typeof fetch;

function defaultAgent(id: string): AgentState {
  return {
    id,
    name: id,
    mode: "primary",
    hidden: false,
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  };
}

function seededAgents(): AgentState[] {
  const build = defaultAgent("build");
  build.system = "stale build prompt";
  build.model = { id: "old-build-model", providerID: "old-provider", variant: "old" };
  build.color = "#123456";
  build.steps = 91;
  build.request = { settings: { stale: true }, headers: { "x-stale": "build" }, body: { stale: true } };
  build.permissions.push(
    { action: "read", resource: "old-build-rule", effect: "deny" },
    { action: "*", resource: "*", effect: "deny" },
  );

  const swe = defaultAgent("swe");
  swe.system = "stale swe prompt";
  swe.model = { id: "old-swe-model", providerID: "old-provider", variant: "old" };
  swe.color = "#654321";
  swe.steps = 92;
  swe.request = { settings: { stale: true }, headers: { "x-stale": "swe" }, body: { stale: true } };
  swe.permissions.push({ action: "edit", resource: "old-swe-rule", effect: "ask" });

  const unrelated = defaultAgent("unrelated");
  unrelated.system = "host-owned agent";
  unrelated.request.body = { hostOwned: true };
  unrelated.permissions.push({ action: "write", resource: "host-rule", effect: "deny" });
  return [build, swe, unrelated];
}

function makeFixture() {
  const tools = new Map<string, NativeToolInfo>();
  const skills = new Map<string, { id: string; name: string; description: string; path: string; content: string }>();
  const agents = new Map(seededAgents().map((agent) => [agent.id, agent]));
  const commands = new Map<string, RegisteredCommand>();
  const initialAgents = new Map([...agents].map(([id, agent]) => [id, structuredClone(agent)]));
  const transformCalls = { tool: 0, skill: 0, agent: 0, command: 0 };
  const sessionCalls: Array<{ method: string; input?: unknown }> = [];
  const serviceCalls: string[] = [];
  const switchedAgents: Array<{ sessionID: string; agent: string }> = [];
  const switchedModels: Array<{ sessionID: string; model: NonNullable<AgentState["model"]> }> = [];
  const sessionModels = new Map<string, AgentState["model"]>();
  const promptModels: Array<AgentState["model"]> = [];
  const prompts: Array<Record<string, unknown>> = [];
  const options: Record<string, unknown> = { trustedWorkspaceWrites: true };
  let globalDefault = "host-default";
  let defaultChanges = 0;

  const forbiddenService = (name: string) => new Proxy({}, {
    get(_target, property) {
      return (..._args: unknown[]) => {
        serviceCalls.push(`${name}.${String(property)}`);
        throw new Error(`${name} calls are disabled in packed verification`);
      };
    },
  });

  const context = {
    options,
    session: {
      async get(input: { sessionID: string }) {
        sessionCalls.push({ method: "get", input });
        return { location: { directory: cleanRoom } };
      },
      hook(input: unknown) {
        sessionCalls.push({ method: "hook", input });
        throw new Error("V1/compaction hooks must not be registered");
      },
      async switchAgent(input: { sessionID: string; agent: string }) {
        sessionCalls.push({ method: "switchAgent", input });
        switchedAgents.push(input);
      },
      async switchModel(input: { sessionID: string; model: NonNullable<AgentState["model"]> }) {
        sessionCalls.push({ method: "switchModel", input });
        switchedModels.push(input);
        sessionModels.set(input.sessionID, input.model);
      },
      async prompt(input: Record<string, unknown>) {
        sessionCalls.push({ method: "prompt", input });
        prompts.push(input);
        promptModels.push(sessionModels.get(input.sessionID as string));
      },
    },
    tool: {
      async transform(callback: (editor: { add(tool: NativeToolInfo): void }) => void) {
        transformCalls.tool += 1;
        callback({ add: (tool) => tools.set(tool.name, tool) });
      },
    },
    skill: {
      async transform(callback: (editor: {
        get(id: string): unknown;
        add(skill: { id: string; name: string; description: string; path: string; content: string }): void;
      }) => void) {
        transformCalls.skill += 1;
        callback({ get: (id) => skills.get(id), add: (skill) => skills.set(skill.id, skill) });
      },
    },
    agent: {
      async get({ agentID }: { agentID: string }) {
        const agent = agents.get(agentID);
        assert.ok(agent, `Unknown agent: ${agentID}`);
        return { data: agent };
      },
      async transform(callback: (editor: {
        list(): AgentState[];
        get(id: string): AgentState | undefined;
        default(id: string | undefined): void;
        update(id: string, update: (agent: AgentState) => void): void;
        remove(id: string): boolean;
      }) => void) {
        transformCalls.agent += 1;
        callback({
          list: () => [...agents.values()],
          get: (id) => agents.get(id),
          default(id) {
            defaultChanges += 1;
            globalDefault = id ?? "";
          },
          update(id, update) {
            const agent = agents.get(id) ?? defaultAgent(id);
            update(agent);
            agents.set(id, agent);
          },
          remove: (id) => agents.delete(id),
        });
      },
    },
    command: {
      async transform(callback: (editor: { add(command: RegisteredCommand): void }) => void) {
        transformCalls.command += 1;
        callback({ add: (command) => commands.set(command.name, command) });
      },
    },
    provider: forbiddenService("provider"),
    mcp: forbiddenService("mcp"),
    auth: forbiddenService("auth"),
    config: forbiddenService("config"),
    globalConfig: forbiddenService("globalConfig"),
    globalconfig: forbiddenService("globalconfig"),
  } as unknown as Plugin.Context;

  return {
    context,
    tools,
    skills,
    agents,
    commands,
    initialAgents,
    transformCalls,
    sessionCalls,
    serviceCalls,
    switchedAgents,
    switchedModels,
    sessionModels,
    promptModels,
    prompts,
    options,
    get globalDefault() { return globalDefault; },
    get defaultChanges() { return defaultChanges; },
  };
}

async function setup(fixture: ReturnType<typeof makeFixture>) {
  const beforeRequests = providerRequests;
  await plugin.setup(fixture.context);
  assert.deepEqual(fixture.transformCalls, { tool: 1, skill: 1, agent: 1, command: 1 });
  assert.deepEqual(fixture.sessionCalls, [], "Setup must not call session or compaction APIs");
  assert.deepEqual(fixture.serviceCalls, [], "Setup must not call provider, MCP, auth, or config APIs");
  assert.equal(providerRequests, beforeRequests, "Setup must not make provider requests");
}

function toolFor(fixture: ReturnType<typeof makeFixture>, name: string): RegisteredTool {
  assert.ok(fixture.tools.has(name), `Missing tool ${name}`);
  return fixture.tools.get(name)! as unknown as RegisteredTool;
}

function toolContext(signal = new AbortController().signal, sessionID = "ses_packed") {
  return {
    sessionID,
    messageID: "msg_packed",
    agent: "build",
    id: "call_packed",
    signal,
    progress: async () => {},
  } as unknown as NativeToolContext;
}

async function invoke(fixture: ReturnType<typeof makeFixture>, name: string, args: unknown, signal?: AbortSignal) {
  const tool = toolFor(fixture, name);
  return tool.execute(tool.input.parse(args), toolContext(signal));
}

async function main() {
  try {
    const fixture = makeFixture();
    await setup(fixture);

    assert.deepEqual([...fixture.tools.keys()].sort(), [...toolNames].sort());
    assert.equal(fixture.tools.size, 9);
    assert.deepEqual([...fixture.skills.keys()].sort(), golden.skills.map((skill) => skill.id).sort());
    assert.equal(fixture.skills.size, 6);
    assert.deepEqual([...fixture.commands.keys()], ["review"]);
    assert.equal(fixture.commands.size, 1);

    for (const expected of golden.skills) {
      const skill = fixture.skills.get(expected.id)!;
      assert.equal(skill.name, expected.name);
      assert.equal(skill.description, expected.description);
      assert.equal(skill.content, expected.content);
      const assetPath = resolve(skill.path);
      assert.ok(inside(packageDirectory, assetPath), `${expected.id} skill path escaped the package`);
      assert.equal(await realpath(assetPath), await realpath(join(packageDirectory, expected.assetPath)));
    }

    const expectedAgentNames = Object.keys(golden.agents).sort();
    const activeAgentNames = [...fixture.agents.keys()].filter((id) => id !== "unrelated").sort();
    assert.deepEqual(activeAgentNames, expectedAgentNames);
    assert.equal(activeAgentNames.length, 10);
    assert.ok(!fixture.agents.has("docs-first-coder"));
    assert.deepEqual([...fixture.agents.keys()].sort(), [...expectedAgentNames, "unrelated"].sort());

    for (const [id, expected] of Object.entries(golden.agents)) {
      const actual = fixture.agents.get(id)!;
      const originalPermissions = fixture.initialAgents.get(id)?.permissions ?? [];
      assert.equal(actual.name, expected.name);
      assert.equal(actual.system, expected.originalBody, `${id} original prompt changed`);
      assert.equal(actual.model?.id, expected.modelID, `${id} model id differs from source`);
      assert.equal(actual.model?.providerID, expected.providerID, `${id} model provider differs from source`);
      assert.equal(actual.model?.variant, expected.variant, `${id} model variant differs from source`);
      assert.equal(actual.mode, expected.mode, `${id} mode differs from source`);
      assert.equal(actual.description, expected.description);
      assert.equal(actual.hidden, expected.hidden);
      assert.equal(actual.color, expected.color);
      assert.equal(actual.steps, expected.steps);
      assert.deepEqual(actual.request, expected.request, `${id} request settings were not replaced`);
      assert.deepEqual(actual.permissions.slice(0, originalPermissions.length), originalPermissions, `${id} original permissions were lost`);
      assert.deepEqual(actual.permissions.slice(originalPermissions.length), expected.permissions, `${id} declared permissions differ from normalized source`);
    }

    const buildWildcardRules = fixture.agents.get("build")!.permissions
      .filter((permission) => permission.action === "*" && permission.resource === "*");
    assert.deepEqual(buildWildcardRules.map((permission) => permission.effect), ["deny", "allow"]);
    assert.equal(fixture.agents.get("swe")!.model, undefined, "Missing source model must clear the stale model");
    const unrelatedBefore = fixture.initialAgents.get("unrelated");
    assert.deepEqual(fixture.agents.get("unrelated"), unrelatedBefore);
    assert.equal(fixture.globalDefault, "host-default");
    assert.equal(fixture.defaultChanges, 0);

    fixture.agents.get("build")!.request.body.poisoned = true;
    fixture.agents.get("build")!.permissions.at(-1)!.resource = "poisoned";
    const replay = makeFixture();
    await setup(replay);
    const expectedBuild = golden.agents.build!;
    assert.deepEqual(replay.agents.get("build")!.request, expectedBuild.request);
    assert.deepEqual(
      replay.agents.get("build")!.permissions.slice(replay.initialAgents.get("build")!.permissions.length),
      expectedBuild.permissions,
      "A prior transform must not mutate the preset used by a fresh host",
    );

    const created = await invoke(fixture, "workplan_create", {
      id: "packed-check",
      goal: "Verify the packed native plugin",
      planMarkdown: "Before\n",
    });
    assert.equal(created.metadata?.title, "Create workplan");
    assert.equal(created.metadata?.id, "packed-check");
    assert.equal(JSON.parse(created.content!).created, true);
    const workplanPath = join(cleanRoom, ".opencode/workplan/packed-check.json");
    const planPath = join(cleanRoom, ".opencode/workplan/packed-check.md");
    const workplan = JSON.parse(await readFile(workplanPath, "utf8")) as { id: string; goal: string; planFile: string };
    assert.deepEqual({ id: workplan.id, goal: workplan.goal }, {
      id: "packed-check",
      goal: "Verify the packed native plugin",
    });
    assert.equal(workplan.planFile, ".opencode/workplan/packed-check.md");
    assert.equal(await readFile(planPath, "utf8"), "Before\n");

    const patched = await invoke(fixture, "workplan_patch", {
      id: "packed-check",
      patchText: "*** Begin Patch\n*** Update File: .opencode/workplan/packed-check.md\n@@\n-Before\n+After\n*** End Patch",
    });
    assert.equal(patched.metadata?.patched, true);
    assert.equal(patched.metadata?.planFile, ".opencode/workplan/packed-check.md");
    assert.equal(await readFile(planPath, "utf8"), "After\n");

    const imageTool = toolFor(fixture, "viz_generate_image");
    assert.equal(imageTool.options?.permission, "edit");
    fixture.options.trustedWorkspaceWrites = false;
    const beforeImageGuard = fixture.sessionCalls.length;
    await assert.rejects(
      invoke(fixture, "viz_generate_image", { prompt: "test", output_path: "image.png" }),
      /trustedWorkspaceWrites: true/,
    );
    assert.equal(fixture.sessionCalls.length, beforeImageGuard, "Untrusted image execution must stop before session lookup");
    fixture.options.trustedWorkspaceWrites = true;
    await assert.rejects(
      invoke(fixture, "viz_generate_image", { prompt: "test", output_path: "../outside.png" }),
      /output_path must stay within the current worktree/,
    );
    const beforeCancellation = fixture.sessionCalls.length;
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      imageTool.execute(imageTool.input.parse({ prompt: "test", output_path: "image.png" }), toolContext(cancelled.signal)),
    );
    assert.equal(fixture.sessionCalls.length, beforeCancellation, "Cancelled image execution must stop before session lookup");
    assert.equal(providerRequests, 0, "Image guard and cancellation checks must make no provider requests");

    const review = fixture.commands.get("review")!;
    assert.equal(review.description, golden.reviewCommand.description);
    const prompt: ReviewPrompt = {
      text: "Focus on the packed verifier",
      files: [{ uri: "file:///repo/packages/plugin/scripts/verify-packed.ts", name: "verify-packed.ts" }],
      agents: [{ name: "code-checker" }],
      skills: [{ id: "agent-use" }],
      metadata: { trace: "packed-review" },
    };
    fixture.sessionModels.set("ses_review", { providerID: "other-provider", id: "other-model" });
    await review.execute({ sessionID: "ses_review", prompt, delivery: "queue" });
    assert.deepEqual(fixture.switchedAgents, [{ sessionID: "ses_review", agent: golden.reviewCommand.agent }]);
    assert.deepEqual(fixture.switchedModels, [{ sessionID: "ses_review", model: fixture.agents.get("build")!.model }]);
    assert.deepEqual(fixture.promptModels.at(-1), fixture.agents.get("build")!.model);
    assert.deepEqual(fixture.prompts, [{
      ...prompt,
      sessionID: "ses_review",
      text: `${golden.reviewCommand.body}\n\n${prompt.text}`,
      delivery: "queue",
    }]);
    assert.equal(fixture.globalDefault, "host-default");
    assert.equal(fixture.defaultChanges, 0);

    const summary = {
      tools: fixture.tools.size,
      skills: fixture.skills.size,
      agents: activeAgentNames.length,
      commands: fixture.commands.size,
      configFiles: rootConfigs.length,
      v1: false,
      patch: "workspace-only",
    };
    console.log(JSON.stringify(summary));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await main();

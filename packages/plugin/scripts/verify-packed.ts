import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { parseOption } from "@opencode/core/config/markdown";
import { normalize } from "@opencode/core/config/normalize";
import { Agent } from "@opencode/schema/agent";
import { Info as ConfigAgentInfo } from "@opencode/schema/config/agent";
import { Model } from "@opencode/schema/model";
import { Schema } from "effect";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const archivePath = join(packageRoot, "rice-opencode-plugin-0.1.0.tgz");
const cleanRoom = await mkdtemp(join(tmpdir(), "rice-opencode-plugin-"));
const childPath = join(cleanRoom, "verify-packed-child.ts");
const goldenPath = join(cleanRoom, "source-golden.json");
const skillNames = ["agent-use", "frontend-design", "git-commit", "shell-strategy", "workflow-execute", "workflow-plan"];
const sourceAgentNames = [
  "build",
  "chat",
  "code-checker",
  "code-writer",
  "docs-first-coder",
  "document-proofreader",
  "explore",
  "plan",
  "plan-checker",
  "researcher",
  "swe",
];
const activeAgentNames = sourceAgentNames.filter((name) => name !== "docs-first-coder");

async function run(command: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed:\n${stderr || stdout}`);
  return stdout;
}

async function filesUnder(directory: string): Promise<string[]> {
  const files = await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return files.flat().sort();
}

async function markdown(path: string, label: string) {
  const parsed = parseOption(await readFile(path, "utf8"));
  assert.ok(parsed, `Invalid Markdown frontmatter: ${label}`);
  return parsed;
}

async function normalizeAgent(id: string) {
  const source = await markdown(resolve(repositoryRoot, "agents", `${id}.md`), `agents/${id}.md`);
  const normalized = normalize({ agent: { [id]: { ...source.data, prompt: source.content } } });
  assert.ok(normalized.type === "normalized", `Cannot normalize agents/${id}.md`);
  assert.deepEqual(normalized.diagnostics, [], `Agent normalization diagnostics for ${id}`);
  const config = Schema.decodeUnknownSync(ConfigAgentInfo)(
    (normalized.encoded.agents as Record<string, unknown>)[id],
  );
  if (config.disabled) return undefined;

  const defaults = Agent.Info.default(Schema.decodeUnknownSync(Agent.ID)(id));
  const model = config.model === undefined
    ? undefined
    : Schema.decodeUnknownSync(Model.Ref)({
        providerID: config.model.providerID,
        id: config.model.model,
        ...(config.model.variant === undefined ? {} : { variant: config.model.variant }),
      });
  const agent = Schema.decodeUnknownSync(Agent.Info)({
    ...defaults,
    ...(model === undefined ? {} : { model }),
    ...(config.system === undefined ? {} : { system: config.system }),
    ...(config.description === undefined ? {} : { description: config.description }),
    mode: config.mode ?? defaults.mode,
    hidden: config.hidden ?? defaults.hidden,
    ...(config.color === undefined ? {} : { color: config.color }),
    ...(config.steps === undefined ? {} : { steps: config.steps }),
    request: {
      settings: defaults.request.settings,
      headers: config.request?.headers ?? defaults.request.headers,
      body: config.request?.body ?? defaults.request.body,
    },
    permissions: config.permissions ?? [],
  });

  return {
    originalBody: source.content,
    name: agent.name,
    modelID: agent.model?.id,
    providerID: agent.model?.providerID,
    variant: agent.model?.variant,
    mode: agent.mode,
    request: agent.request,
    permissions: agent.permissions,
    description: agent.description,
    hidden: agent.hidden,
    color: agent.color,
    steps: agent.steps,
  };
}

async function sourceGolden() {
  const agents: Record<string, NonNullable<Awaited<ReturnType<typeof normalizeAgent>>>> = {};
  for (const name of sourceAgentNames) {
    const agent = await normalizeAgent(name);
    if (agent) agents[name] = agent;
  }
  assert.deepEqual(Object.keys(agents).sort(), activeAgentNames.slice().sort());

  const skills = await Promise.all(skillNames.map(async (id) => {
    const source = await markdown(resolve(repositoryRoot, "skills", id, "SKILL.md"), `skills/${id}/SKILL.md`);
    return {
      id,
      name: id,
      description: source.data.description as string,
      ...(source.data.autoinvoke === undefined ? {} : { autoinvoke: source.data.autoinvoke as boolean }),
      content: source.content,
      assetPath: `dist/skills/${id}/SKILL.md`,
    };
  }));
  const review = await markdown(resolve(repositoryRoot, "commands/review.md"), "commands/review.md");
  const reviewCommand = {
    name: "review",
    description: review.data.description as string,
    agent: review.data.agent as string,
    body: review.content,
  };

  const sourceAssetPaths = [
    ...(await Promise.all(skillNames.map((name) => filesUnder(resolve(repositoryRoot, "skills", name))))).flat(),
    ...activeAgentNames.map((name) => resolve(repositoryRoot, "agents", `${name}.md`)),
    resolve(repositoryRoot, "commands/review.md"),
  ];
  const assetFiles = Object.fromEntries(await Promise.all(sourceAssetPaths.map(async (path) => {
    const relativePath = relative(repositoryRoot, path).split("\\").join("/");
    return [`dist/${relativePath}`, (await readFile(path)).toString("base64")];
  })));

  return { agents, skills, reviewCommand, assetFiles };
}

try {
  await run(["bun", "run", "build"], packageRoot);
  await run(["bun", "pm", "pack"], packageRoot);
  await writeFile(join(cleanRoom, "package.json"), JSON.stringify({ name: "rice-opencode-pack-check", private: true, type: "module" }));
  await writeFile(goldenPath, JSON.stringify(await sourceGolden()));
  await copyFile(join(import.meta.dir, "verify-packed-child.ts"), childPath);
  await run(["bun", "add", archivePath, "@opencode/plugin@2.0.20"], cleanRoom);
  const output = await run(["bun", "run", childPath, goldenPath], cleanRoom);
  console.log(output.trim());
} finally {
  await rm(cleanRoom, { recursive: true, force: true });
  await rm(archivePath, { force: true });
}

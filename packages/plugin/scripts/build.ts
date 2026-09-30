import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseOption } from "@opencode/core/config/markdown";
import { normalize } from "@opencode/core/config/normalize";
import { Agent } from "@opencode/schema/agent";
import { Info as ConfigAgentInfo } from "@opencode/schema/config/agent";
import { Model } from "@opencode/schema/model";
import { Schema } from "effect";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const outputDirectory = resolve(packageRoot, "dist");
const agentNames = [
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
const skillNames = [
  "agent-use",
  "frontend-design",
  "git-commit",
  "shell-strategy",
  "workflow-execute",
  "workflow-plan",
];

function parseMarkdown(path: string, label: string) {
  const markdown = parseOption(readFileSync(path, "utf8"));
  if (!markdown) throw new Error(`Invalid Markdown frontmatter: ${label}`);
  return markdown;
}

function compileAgent(id: string) {
  const sourcePath = resolve(repositoryRoot, "agents", `${id}.md`);
  const markdown = parseMarkdown(sourcePath, `agents/${id}.md`);
  const normalized = normalize({
    agent: { [id]: { ...markdown.data, prompt: markdown.content } },
  });
  if (normalized.type !== "normalized" || normalized.diagnostics.length) {
    throw new Error(`Cannot normalize agents/${id}.md: ${JSON.stringify(normalized.diagnostics)}`);
  }

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

  return agent;
}

function compileSkill(id: string) {
  const sourcePath = resolve(repositoryRoot, "skills", id, "SKILL.md");
  const markdown = parseMarkdown(sourcePath, `skills/${id}/SKILL.md`);
  if (markdown.data.name !== id || typeof markdown.data.description !== "string") {
    throw new Error(`Incomplete skill metadata: skills/${id}/SKILL.md`);
  }
  if (markdown.data.autoinvoke !== undefined && typeof markdown.data.autoinvoke !== "boolean") {
    throw new Error(`Invalid skill autoinvoke value: skills/${id}/SKILL.md`);
  }

  return {
    id,
    name: id,
    description: markdown.data.description,
    ...(markdown.data.autoinvoke === undefined ? {} : { autoinvoke: markdown.data.autoinvoke }),
    assetPath: `skills/${id}/SKILL.md`,
    content: markdown.content,
  };
}

function compileReviewCommand() {
  const sourcePath = resolve(repositoryRoot, "commands", "review.md");
  const markdown = parseMarkdown(sourcePath, "commands/review.md");
  if (typeof markdown.data.description !== "string" || typeof markdown.data.agent !== "string") {
    throw new Error("Incomplete command metadata: commands/review.md");
  }
  return {
    name: "review",
    description: markdown.data.description,
    agent: markdown.data.agent,
    body: markdown.content,
  };
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const agents = Object.fromEntries(
  agentNames.flatMap((name) => {
    const agent = compileAgent(name);
    return agent ? [[name, agent]] : [];
  }),
);
const skills = skillNames.map(compileSkill);
const reviewCommand = compileReviewCommand();
await writeFile(resolve(outputDirectory, "preset.js"), `export default ${JSON.stringify({ agents, skills, reviewCommand })};\n`);

for (const skill of skillNames) {
  await cp(
    resolve(repositoryRoot, "skills", skill),
    resolve(outputDirectory, "skills", skill),
    { recursive: true },
  );
}
for (const agent of Object.keys(agents)) {
  await cp(
    resolve(repositoryRoot, "agents", `${agent}.md`),
    resolve(outputDirectory, "agents", `${agent}.md`),
  );
}
await cp(resolve(repositoryRoot, "commands", "review.md"), resolve(outputDirectory, "commands", "review.md"));

const result = await Bun.build({
  entrypoints: [resolve(packageRoot, "src/index.ts")],
  outdir: outputDirectory,
  target: "bun",
  format: "esm",
  external: ["@opencode/plugin"],
  minify: false,
  sourcemap: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

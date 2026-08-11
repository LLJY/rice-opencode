import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
const archive = join(root, "rice-opencode-plugin-1.0.0.tgz");
const cleanRoom = await mkdtemp(join(tmpdir(), "rice-opencode-pack-"));

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed:\n${stderr || stdout}`);
  return stdout;
}

try {
  await run(["bun", "pm", "pack"], root);
  await writeFile(join(cleanRoom, "package.json"), JSON.stringify({ type: "module" }));
  await run(["bun", "add", archive], cleanRoom);

  const packageRoot = join(cleanRoom, "node_modules/@rice-opencode/plugin");
  const module = await import(join(packageRoot, "src/plugin/index.ts"));
  const credentialDirectory = join(cleanRoom, "credentials");
  await mkdir(credentialDirectory, { recursive: true });
  await Bun.write(join(credentialDirectory, ".github-pat"), "github-test");
  await Bun.write(join(credentialDirectory, ".context7-api-key"), "context7-test");
  await Bun.write(join(credentialDirectory, ".exa-api-key"), "exa-test");

  const hooks = await module.RicePlugin(
    {
      client: {},
      project: {},
      directory: cleanRoom,
      worktree: cleanRoom,
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost"),
      $: {},
    },
    { credentialDirectory },
  );
  if ("experimental.session.compacting" in hooks) throw new Error("Legacy compaction hook is still exported");

  const config: any = {
    agent: { chat: { model: "custom/model" } },
    command: { review: { agent: "custom-reviewer" } },
    mcp: { deepwiki: { type: "remote", url: "https://example.invalid/mcp", enabled: false } },
    skills: { paths: ["/existing/skills"] },
    tools: { hound_smart_search: true },
  };
  await hooks.config(config);
  await hooks.config(config);
  const toolNames = Object.keys(hooks.tool ?? {});
  const agentNames = Object.keys(config.agent ?? {});
  const commandNames = Object.keys(config.command ?? {});
  const mcpNames = Object.keys(config.mcp ?? {});
  const skillPath = config.skills?.paths?.find((path: string) => path !== "/existing/skills");

  if (toolNames.length !== 8) throw new Error(`Expected 8 tools, found ${toolNames.length}`);
  if (agentNames.length !== 10) throw new Error(`Expected 10 agents, found ${agentNames.length}`);
  if (commandNames.join(",") !== "review") throw new Error(`Unexpected commands: ${commandNames.join(",")}`);
  if (mcpNames.length !== 7) throw new Error(`Expected 7 MCPs, found ${mcpNames.length}`);
  if (!mcpNames.includes("researcher-mcp") || !mcpNames.includes("ddg-search")) {
    throw new Error(`Stable MCP ids are missing: ${mcpNames.join(",")}`);
  }
  if (!skillPath || config.skills.paths.length !== 2) throw new Error("Bundled skills path was not registered idempotently");
  if (config.agent.chat.model !== "custom/model") throw new Error("User agent model override was replaced");
  if (config.command.review.agent !== "custom-reviewer") throw new Error("User command override was replaced");
  if (config.mcp.deepwiki.url !== "https://example.invalid/mcp" || config.mcp.deepwiki.enabled !== false) {
    throw new Error("User MCP override was replaced");
  }
  if (config.tools.hound_smart_search !== true) throw new Error("User tool override was replaced");
  const commandText = JSON.stringify(Object.values(config.mcp).flatMap((definition: any) => definition.command ?? []));
  if (["github-test", "context7-test", "exa-test"].some((secret) => commandText.includes(secret))) {
    throw new Error("Credential leaked into an MCP command argument");
  }

  for (const skill of ["agent-use", "frontend-design", "git-commit", "shell-strategy", "workflow-execute", "workflow-plan"]) {
    await readFile(join(skillPath, skill, "SKILL.md"), "utf8");
  }

  const researcher = join(packageRoot, "assets/bin/linux-x64/researcher-mcp");
  await access(researcher, constants.X_OK);
  const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(researcher).arrayBuffer()).digest("hex");
  const expected = "6d20ad7597a8782dcead785ce348eedb0cef425ac3209671f26bf0b29cd6cf3b";
  if (digest !== expected) throw new Error(`Researcher checksum mismatch: ${digest}`);

  console.log(JSON.stringify({
    package: "@rice-opencode/plugin",
    tools: toolNames.length,
    agents: agentNames.length,
    commands: commandNames.length,
    skills: 6,
    mcps: mcpNames.length,
    compaction: "absent",
    researcherSha256: digest,
  }));
} finally {
  await rm(cleanRoom, { recursive: true, force: true });
  await rm(archive, { force: true });
}

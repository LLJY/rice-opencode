import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const packageRoot = resolve(import.meta.dir, "..");
const archiveName = "rice-opencode-plugin-0.1.0.tgz";
const archivePath = join(packageRoot, archiveName);
const cleanRoom = await mkdtemp(join(tmpdir(), "rice-opencode-plugin-"));

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

try {
  await run(["bun", "run", "build"], packageRoot);
  await run(["bun", "pm", "pack"], packageRoot);
  await writeFile(join(cleanRoom, "package.json"), JSON.stringify({ type: "module" }));
  await run(["bun", "add", archivePath], cleanRoom);

  const installed = await import(join(cleanRoom, "node_modules/@rice-opencode/plugin/dist/index.js"));
  const hooks = await installed.RicePlugin({
    client: {},
    project: {},
    directory: cleanRoom,
    worktree: cleanRoom,
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: {},
  });

  const toolNames = Object.keys(hooks.tool ?? {}).sort();
  if (toolNames.length !== 8) throw new Error(`Expected 8 tools, found ${toolNames.length}`);

  const config: { skills?: { paths?: string[] } } = {};
  await hooks.config?.(config);
  const skillPath = config.skills?.paths?.[0];
  if (!skillPath) throw new Error("Bundled skills path was not registered");
  await readFile(join(skillPath, "workflow-plan/SKILL.md"), "utf8");
  await readFile(join(skillPath, "workflow-execute/SKILL.md"), "utf8");

  const output = { context: [] };
  await hooks["experimental.session.compacting"]?.({ sessionID: "verify" }, output);
  if (output.context[0] !== installed.WORKFLOW_COMPACTION_CONTEXT) {
    throw new Error("Compaction context was not registered from the packed plugin");
  }

  console.log(JSON.stringify({ package: "@rice-opencode/plugin", tools: toolNames.length, skills: 2, compaction: "additive" }));
} finally {
  await rm(cleanRoom, { recursive: true, force: true });
  await rm(archivePath, { force: true });
}

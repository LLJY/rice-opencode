import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const revisions = {
  hound: "1dab81b7fc03721688cfb7775fc1222c7f9805ba",
  "researcher-mcp": "61106bcc107074566562d8c0e24c50c938785d96",
};
const targets = [
  ["linux", "amd64", "linux-x64"], ["linux", "arm64", "linux-arm64"],
  ["darwin", "amd64", "darwin-x64"], ["darwin", "arm64", "darwin-arm64"],
  ["windows", "amd64", "win32-x64"], ["windows", "arm64", "win32-arm64"],
] as const;
const flags = ["-mod=readonly", "-trimpath", "-ldflags=-s -w"];

async function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (status !== 0) throw new Error(`${args.join(" ")} failed:\n${error || output}`);
  return output.trim();
}

async function sourceDigest(directory: string, hash = createHash("sha256")): Promise<string> {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".git") continue;
    hash.update(entry.name);
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await sourceDigest(path, hash);
    else if (entry.isFile()) hash.update(await readFile(path));
    else throw new Error(`Unexpected submodule symlink: ${path}`);
  }
  return hash.copy().digest("hex");
}

export async function buildMcp(repositoryRoot: string, outputDirectory: string) {
  const source = resolve(repositoryRoot, "packages/mcp");
  for (const [name, revision] of Object.entries(revisions)) {
    const directory = join(source, "vendor", name);
    let actual: string;
    try { actual = await run(["git", "rev-parse", "HEAD"], directory); }
    catch { throw new Error(`Initialize MCP submodules first: git submodule update --init --recursive (${name})`); }
    assert.equal(actual, revision, `Unexpected ${name} submodule revision`);
    assert.equal(await run(["git", "status", "--porcelain"], directory), "", `${name} submodule must remain unmodified`);
  }
  await run(["uv", "lock", "--check", "--project", source, "--python", "3.12"], repositoryRoot);
  const destination = join(outputDirectory, "mcp");
  await mkdir(destination, { recursive: true });
  for (const file of ["pyproject.toml", "uv.lock"]) await cp(join(source, file), join(destination, file));
  const files = {
    hound: ["src", "pyproject.toml", "README.md", "LICENSE", "NOTICE.ddgs.txt"],
    "researcher-mcp": ["cmd", "internal", "go.mod", "go.sum", "README.md", "LICENSE"],
  };
  for (const [name, paths] of Object.entries(files)) {
    const target = join(destination, "vendor", name);
    await mkdir(target, { recursive: true });
    for (const file of paths) await cp(join(source, "vendor", name, file), join(target, file), { recursive: true });
  }

  const toolchain = await run(["go", "version"], repositoryRoot);
  const researcher = join(source, "vendor/researcher-mcp");
  const digest = createHash("sha256").update(JSON.stringify({
    revision: revisions["researcher-mcp"], toolchain, flags, source: await sourceDigest(researcher),
  })).digest("hex");
  const cache = join(repositoryRoot, "node_modules/.cache/rice-mcp-build", digest);
  const linkedModules = new Set<string>();
  await mkdir(cache, { recursive: true });
  for (const [os, arch, target] of targets) {
    const name = `researcher-mcp${os === "windows" ? ".exe" : ""}`;
    const binary = join(cache, target, name);
    const temporary = `${binary}.${process.pid}.tmp`;
    await mkdir(join(cache, target), { recursive: true });
    let cached = false;
    try { cached = (await stat(binary)).isFile(); } catch { /* Cold build. */ }
    if (!cached) {
      await run(["go", "build", ...flags, "-o", temporary, "./cmd/google-scholar-mcp"], researcher, {
        ...process.env, CGO_ENABLED: "0", GOOS: os, GOARCH: arch,
      });
      await rename(temporary, binary);
    }
    await chmod(binary, 0o755);
    const info = await run(["go", "version", "-m", binary], repositoryRoot);
    assert.ok(info.includes(`GOOS=${os}`) && info.includes(`GOARCH=${arch}`) && info.includes("CGO_ENABLED=0"), `Incorrect ${target} researcher build`);
    for (const match of info.matchAll(/^\s*dep\s+(\S+)/gm)) linkedModules.add(match[1]!);
    const directory = join(destination, "bin", target);
    await mkdir(directory, { recursive: true });
    await cp(binary, join(directory, name));
  }
  const notices = join(destination, "licenses");
  await mkdir(notices, { recursive: true });
  await cp(join(source, "licenses/go-LICENSE"), join(notices, "go-LICENSE"));
  const modules = (await run(["go", "list", "-m", "-json", ...linkedModules], researcher))
    .split(/\n(?=\{)/).map((json) => JSON.parse(json) as { Path: string; Version: string; Dir: string });
  for (const module of modules) {
    const licenseFiles = (await readdir(module.Dir)).filter((name) => /^(LICENSE|COPYING|NOTICE|COPYRIGHT)(\.|$)/i.test(name));
    assert.ok(licenseFiles.length > 0, `No redistribution notice found for ${module.Path}`);
    const directory = join(notices, `${module.Path.replaceAll("/", "_")}@${module.Version}`);
    await mkdir(directory, { recursive: true });
    for (const file of licenseFiles) await cp(join(module.Dir, file), join(directory, file));
  }
  await writeFile(join(destination, "sources.json"), `${JSON.stringify({ revisions, toolchain, targets: targets.map((target) => target[2]) }, null, 2)}\n`);
}

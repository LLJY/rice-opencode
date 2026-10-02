import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "@opencode/plugin";
import type { MCPEditor } from "@opencode/plugin/promise/mcp";

import { prepareHound } from "../packages/plugin/src/mcp";

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_DIST = resolve(ROOT, "packages/plugin/dist");
const EXPECTED_REVISIONS = {
  hound: "1dab81b7fc03721688cfb7775fc1222c7f9805ba",
  "researcher-mcp": "61106bcc107074566562d8c0e24c50c938785d96",
};
const SUPPORTED_PLATFORMS = ["linux", "darwin", "win32"];
const SUPPORTED_ARCHES = ["x64", "arm64"];
const RESEARCHER_TOOLS = [
  "search_google_scholar_key_words",
  "search_google_scholar_advanced",
  "get_author_info",
  "google_scholar_healthcheck",
  "get_paper_fulltext",
  "search_research_articles",
  "search_research_articles_advanced",
  "get_researcher_info",
  "researcher_mcp_healthcheck",
  "read_research_paper",
];
const HOUND_TOOLS = ["mcp_smart_fetch", "mcp_smart_crawl", "mcp_smart_search"];
const SECRET_ENV_PREFIXES = ["EXA_", "HOUND_SEARCH_"];
const PRIVATE_ENV_VALUES = Object.entries(process.env)
  .filter(([name]) => /(?:EXA_|HOUND_SEARCH_|API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|PROXY|URL)/i.test(name))
  .map(([, value]) => value)
  .filter((value): value is string => typeof value === "string" && value.length >= 4);

type JsonObject = Record<string, unknown>;
type Snapshot = Map<string, string>;

function secretEnvironmentKey(name: string): boolean {
  const normalized = name.toUpperCase();
  return SECRET_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function makeIsolatedEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (secretEnvironmentKey(key)) delete env[key];

  const home = join(root, "home");
  const temp = join(root, "tmp");
  for (const key of ["UV_PROJECT", "UV_PROJECT_ENVIRONMENT", "UV_WORKING_DIR", "UV_CONFIG_FILE"]) delete env[key];
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_DATA_HOME: join(root, "xdg-data"),
    UV_CACHE_DIR: join(root, "uv-cache"),
    UV_PYTHON_INSTALL_DIR: join(root, "python"),
    UV_PROJECT_ENVIRONMENT: join(root, "project-env"),
    PLAYWRIGHT_BROWSERS_PATH: join(root, "browsers"),
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
  });
  return env;
}

async function withoutSearchSecrets<T>(run: () => Promise<T>): Promise<T> {
  const removed = Object.entries(process.env).filter(([key]) => secretEnvironmentKey(key));
  for (const [key] of removed) delete process.env[key];
  try {
    return await run();
  } finally {
    for (const [key, value] of removed) if (value !== undefined) process.env[key] = value;
  }
}

function hash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(path: string): Promise<string> {
  return hash(await readFile(path));
}

async function addTree(snapshot: Snapshot, directory: string, label: string): Promise<void> {
  const rootStat = await lstat(directory);
  snapshot.set(label, `directory:${rootStat.mode & 0o777}`);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    const key = `${label}/${entry.name}`;
    if (entry.isDirectory()) {
      await addTree(snapshot, path, key);
    } else if (entry.isSymbolicLink()) {
      snapshot.set(key, `symlink:${await readlink(path)}`);
    } else if (entry.isFile()) {
      const info = await lstat(path);
      snapshot.set(key, `file:${info.mode & 0o777}:${await hashFile(path)}`);
    }
  }
}

const ARTIFACT_DIRECTORIES = new Set([".venv", ".hatch", "dist", "build", "target"]);
const LOCK_FILENAME = /(?:^|[-_.])lock(?:$|[.-])/i;
let upstreamHatchCacheChanges: string[] = [];
let report: Record<string, unknown> = {};

async function snapshotWorkspaceArtifacts(workspace: string): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ARTIFACT_DIRECTORIES.has(entry.name)) await addTree(snapshot, path, `workspace/${key}`);
        else await visit(path, key);
      } else if (entry.isSymbolicLink() && (ARTIFACT_DIRECTORIES.has(entry.name) || LOCK_FILENAME.test(entry.name))) {
        snapshot.set(`workspace/${key}`, `symlink:${await readlink(path)}`);
      } else if (entry.isFile() && (LOCK_FILENAME.test(entry.name) || entry.name === "go.sum")) {
        const info = await lstat(path);
        snapshot.set(`workspace/${key}`, `file:${info.mode & 0o777}:${await hashFile(path)}`);
      }
    }
  };
  await visit(workspace, "");
  return snapshot;
}

function changedPaths(before: Snapshot, after: Snapshot): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

function isHatchCache(path: string): boolean {
  const parts = path.split(/[\\/]/);
  return parts.some((part, index) => part === ".hatch" && (parts[index + 1] === "cache" || index === parts.length - 1));
}

function parseDist(args: string[]): string {
  if (args.length === 0) return DEFAULT_DIST;
  if (args.length !== 2 || args[0] !== "--dist") throw new Error("usage: bun run scripts/check-mcp.ts [--dist ABS]");
  if (!isAbsolute(args[1])) throw new Error("--dist must be an absolute path");
  return resolve(args[1]);
}

function appendTail(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-8_000);
}

function safeDiagnostic(stderr: string): string | undefined {
  const line = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim();
  if (!line || PRIVATE_ENV_VALUES.some((value) => line.includes(value))) return undefined;
  if (/(?:api[_ -]?key|token|secret|password|credential|authorization|bearer\s|:\/\/[^/\s:@]+:[^/\s@]+@)/i.test(line)) return undefined;
  return line.slice(0, 500);
}

function recordProcessError(stage: string, code: number | null, signal: NodeJS.Signals | null, stderr = ""): Error {
  const status = `${stage} exited ${code === null ? `after ${signal ?? "a signal"}` : `with code ${code}`}`;
  const diagnostic = safeDiagnostic(stderr);
  return new Error(diagnostic ? `${status}: ${diagnostic}` : status);
}

function runQuiet(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  stage: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      rejectPromise(new Error(`${stage} could not start${code ? ` (${code})` : ""}`));
      return;
    }

    let settled = false;
    let timedOut = false;
    let stderr = "";
    let timeout: ReturnType<typeof setTimeout>;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      signal.removeEventListener("abort", abort);
    };
    const terminate = () => {
      if (child.kill("SIGTERM")) {
        escalation = setTimeout(() => child.kill("SIGKILL"), 1_500);
        escalation.unref?.();
      }
    };
    const abort = () => terminate();
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr = appendTail(stderr, chunk); });
    child.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(() => rejectPromise(new Error(`${stage} could not start${code ? ` (${code})` : ""}`)));
    });
    child.once("close", (code, childSignal) => finish(() => {
      if (timedOut) {
        const diagnostic = safeDiagnostic(stderr);
        rejectPromise(new Error(`${stage} timed out after ${timeoutMs}ms${diagnostic ? `: ${diagnostic}` : ""}`));
      }
      else if (signal.aborted) rejectPromise(new Error(`${stage} aborted`));
      else if (code !== 0) rejectPromise(recordProcessError(stage, code, childSignal, stderr));
      else resolvePromise();
    }));
    timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref?.();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function runCapture(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  stage: string,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      rejectPromise(new Error(`${stage} could not start${code ? ` (${code})` : ""}`));
      return;
    }

    let output = "";
    let stderr = "";
    let settled = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (escalation) clearTimeout(escalation);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      if (child.kill("SIGTERM")) {
        escalation = setTimeout(() => child.kill("SIGKILL"), 1_500);
        escalation.unref?.();
      }
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr = appendTail(stderr, chunk); });
    child.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(() => rejectPromise(new Error(`${stage} could not start${code ? ` (${code})` : ""}`)));
    });
    child.once("close", (code, childSignal) => finish(() => {
      if (signal.aborted) rejectPromise(new Error(`${stage} aborted`));
      else if (code !== 0) rejectPromise(recordProcessError(stage, code, childSignal, stderr));
      else resolvePromise(output);
    }));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function listMcpTools(
  serverName: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<string[]> {
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const lines = createInterface({ input: child.stdout! });
  const pending = new Map<number, { resolve: (message: JsonObject) => void; reject: (error: Error) => void }>();
  let protocolError: string | undefined;
  let stderr = "";
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let shutdown = "stdin-eof";
  let closedResolve!: () => void;
  const closed = new Promise<void>((resolvePromise) => { closedResolve = resolvePromise; });
  const failPending = (message: string) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`${serverName}: ${message}`));
    pending.clear();
  };
  const protocolFailure = (message: string) => {
    if (protocolError) return;
    protocolError = message;
    failPending(message);
  };

  child.once("error", (error) => {
    const code = (error as NodeJS.ErrnoException).code;
    protocolFailure(`could not start${code ? ` (${code})` : ""}`);
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr = appendTail(stderr, chunk); });
  child.once("close", (code, childSignal) => {
    exitCode = code;
    exitSignal = childSignal;
    closedResolve();
    const status = `closed before replying${code === null ? ` (${childSignal ?? "signal"})` : ` (code ${code})`}`;
    const diagnostic = safeDiagnostic(stderr);
    failPending(diagnostic ? `${status}: ${diagnostic}` : status);
  });
  child.stdin.on("error", () => protocolFailure("stdio input closed unexpectedly"));
  lines.on("line", (line) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      protocolFailure("wrote non-JSON text to stdout");
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as JsonObject).jsonrpc !== "2.0") {
      protocolFailure("wrote an invalid JSON-RPC message to stdout");
      return;
    }
    const message = value as JsonObject;
    if (typeof message.method === "string" && "id" in message) {
      protocolFailure("sent an unexpected server request during catalog listing");
      return;
    }
    if (typeof message.id === "number") {
      const waiter = pending.get(message.id);
      if (waiter) {
        if ("error" in message) waiter.reject(new Error(`${serverName}: JSON-RPC request failed`));
        else waiter.resolve(message);
        pending.delete(message.id);
      }
    }
  });

  const request = (id: number, method: string, params: JsonObject): Promise<JsonObject> => new Promise((resolvePromise, rejectPromise) => {
    if (protocolError) {
      rejectPromise(new Error(`${serverName}: ${protocolError}`));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      pending.delete(id);
      callback();
    };
    const onAbort = () => finish(() => rejectPromise(new Error(`${serverName}: MCP request aborted`)));
    pending.set(id, {
      resolve: (message) => finish(() => resolvePromise(message)),
      reject: (error) => finish(() => rejectPromise(error)),
    });
    timer = setTimeout(() => finish(() => rejectPromise(new Error(`${serverName}: ${method} timed out after 120000ms`))), 120_000);
    timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    } catch {
      finish(() => rejectPromise(new Error(`${serverName}: could not write MCP request`)));
    }
  });

  const waitForClose = async (milliseconds: number): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<false>((resolvePromise) => {
      timer = setTimeout(() => resolvePromise(false), milliseconds);
      timer.unref?.();
    });
    const result = await Promise.race([closed.then(() => true as const), timedOut]);
    clearTimeout(timer!);
    return result;
  };
  const closeGracefully = async () => {
    if (exitCode !== null || child.killed) return;
    child.stdin.end();
    if (await waitForClose(10_000)) return;
    shutdown = "SIGTERM";
    child.kill("SIGTERM");
    if (await waitForClose(1_500)) return;
    shutdown = "SIGKILL";
    child.kill("SIGKILL");
    if (!(await waitForClose(1_500))) throw new Error(`${serverName}: process did not stop after SIGKILL`);
  };

  let successfulTools: string[] | undefined;
  try {
    const initialized = await request(1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "rice-opencode-mcp-smoke", version: "1.0.0" },
    });
    const initializeResult = initialized.result;
    assert.ok(initializeResult && typeof initializeResult === "object", `${serverName}: missing initialize result`);
    const negotiatedVersion = (initializeResult as JsonObject).protocolVersion;
    assert.equal(typeof negotiatedVersion, "string", `${serverName}: missing negotiated protocol version`);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const names: string[] = [];
    let cursor: string | undefined;
    let requestId = 2;
    do {
      const page = await request(requestId++, "tools/list", cursor ? { cursor } : {});
      assert.ok(page.result && typeof page.result === "object", `${serverName}: missing tools/list result`);
      const result = page.result as JsonObject;
      assert.ok(Array.isArray(result.tools), `${serverName}: tools/list returned no tools array`);
      for (const tool of result.tools) {
        assert.ok(tool && typeof tool === "object" && typeof (tool as JsonObject).name === "string", `${serverName}: invalid tool entry`);
        names.push((tool as JsonObject).name as string);
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    } while (cursor);

    assert.ok(names.length > 0, `${serverName}: tools/list returned an empty catalog`);
    successfulTools = names;
  } finally {
    await closeGracefully();
    lines.close();
  }

  if (protocolError) throw new Error(`${serverName}: ${protocolError}`);
  if (shutdown === "stdin-eof") assert.equal(exitCode, 0, `${serverName}: server exited unsuccessfully`);
  else assert.equal(exitSignal, shutdown, `${serverName}: server did not stop after our shutdown signal`);
  report[`${serverName}Shutdown`] = shutdown;
  assert.ok(successfulTools, `${serverName}: MCP handshake did not complete`);
  return successfulTools;
}

function assertTools(serverName: string, actual: string[], expected: string[]): void {
  const names = new Set(actual);
  assert.equal(names.size, actual.length, `${serverName}: duplicate tool names returned`);
  assert.deepEqual(expected.filter((name) => !names.has(name)), [], `${serverName}: expected tools are missing`);
}

async function main(): Promise<void> {
  stage = "argument validation";
  const distDirectory = parseDist(process.argv.slice(2));
  const mcpDirectory = resolve(distDirectory, "mcp");
  const lockPath = join(mcpDirectory, "uv.lock");
  const manifestPath = join(mcpDirectory, "pyproject.toml");
  const sourcesPath = join(mcpDirectory, "sources.json");

  const platform = process.platform;
  const arch = process.arch;
  if (!SUPPORTED_PLATFORMS.includes(platform) || !SUPPORTED_ARCHES.includes(arch)) {
    throw new Error(`unsupported MCP platform ${platform}-${arch}; supported platforms: linux/darwin/win32 x64/arm64`);
  }
  const target = `${platform}-${arch}`;
  report = {
    platform: target,
    dist: { mode: distDirectory === DEFAULT_DIST ? "default" : "relocated", path: distDirectory },
    researcherTools: null,
    houndTools: null,
    browser: "pending",
    uvLock: "pending",
  };
  const executable = join(mcpDirectory, "bin", target, `researcher-mcp${platform === "win32" ? ".exe" : ""}`);
  const researcherCwd = join(mcpDirectory, "vendor", "researcher-mcp");
  const houndSourceManifest = join(mcpDirectory, "vendor", "hound", "pyproject.toml");

  stage = "packaged MCP validation";
  const [wrapperManifest, lockDigest, sourcesText, houndManifest] = await Promise.all([
    readFile(manifestPath, "utf8"),
    hashFile(lockPath),
    readFile(sourcesPath, "utf8"),
    readFile(houndSourceManifest, "utf8"),
  ]);
  const sources = JSON.parse(sourcesText) as { revisions?: Record<string, string>; targets?: string[] };
  assert.match(wrapperManifest, /hound-mcp\[all\]==12\.4\.1/, "packaged wrapper must pin Hound 12.4.1");
  assert.match(houndManifest, /^version\s*=\s*"12\.4\.1"$/m, "packaged Hound source must be version 12.4.1");
  assert.deepEqual(sources.revisions, EXPECTED_REVISIONS, "packaged MCP source pins do not match the approved revisions");
  assert.ok(sources.targets?.includes(target), `packaged MCP targets do not include ${target}`);
  const binaryStat = await lstat(executable);
  assert.ok(binaryStat.isFile(), `researcher binary is missing for ${target}`);
  if (platform !== "win32") await access(executable, fsConstants.X_OK);
  assert.ok((await lstat(researcherCwd)).isDirectory(), "packaged researcher source directory is missing");
  assert.match(await readFile(lockPath, "utf8"), /name = "hound-mcp"\nversion = "12\.4\.1"\nsource = \{ directory = "vendor\/hound" \}/, "uv.lock must pin the packaged Hound source");

  await mkdir("/tmp/opencode", { recursive: true });
  const tempRoot = await mkdtemp("/tmp/opencode/rice-mcp-smoke-");
  report.cacheRoot = tempRoot;
  const isolatedEnv = makeIsolatedEnvironment(tempRoot);
  for (const directory of [
    isolatedEnv.HOME!, isolatedEnv.TMPDIR!, isolatedEnv.XDG_CACHE_HOME!, isolatedEnv.XDG_CONFIG_HOME!, isolatedEnv.XDG_DATA_HOME!,
    isolatedEnv.UV_CACHE_DIR!, isolatedEnv.UV_PYTHON_INSTALL_DIR!, isolatedEnv.PLAYWRIGHT_BROWSERS_PATH!,
  ]) await mkdir(directory, { recursive: true });

  const controller = new AbortController();
  const totalTimeout = setTimeout(() => controller.abort(new Error("preflight time limit")), 9 * 60_000);
  totalTimeout.unref?.();
  const distBefore: Snapshot = new Map();
  await addTree(distBefore, distDirectory, "dist");
  const workspaceBefore = await snapshotWorkspaceArtifacts(ROOT);
  const lockShaBefore = lockDigest;
  const browserWarnings: string[] = [];
  let pluginCleanup: Plugin.Cleanup | void;
  try {
    stage = "uv lock --check";
    try {
      await runQuiet("uv", ["lock", "--check", "--project", mcpDirectory], tempRoot, isolatedEnv, controller.signal, stage, 120_000);
      report.uvLock = "checked-unchanged";
    } finally {
      assert.equal(await hashFile(lockPath), lockShaBefore, "packaged input uv.lock changed during lock validation");
    }

    stage = "Hound provisioning";
    const prepared = await withoutSearchSecrets(() => prepareHound(mcpDirectory, join(tempRoot, "cache"), controller.signal, {
      env: isolatedEnv,
      warn: (message) => browserWarnings.push(message),
    }));
    const browserReady = Boolean(prepared.browserPath);
    report.browser = browserReady ? "chromium-ready" : "http-only";
    for (const path of [prepared.runtimeDirectory, prepared.pythonPath, prepared.browsersPath, prepared.homePath]) {
      const rel = relative(tempRoot, resolve(path));
      assert.ok(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `Hound runtime escaped isolated root: ${path}`);
    }
    assert.equal(prepared.environment.HOME, prepared.homePath, "Hound HOME is not isolated");
    assert.equal(prepared.environment.PLAYWRIGHT_BROWSERS_PATH, prepared.browsersPath, "Chromium cache is not isolated");
    if (browserReady) {
      const browserRel = relative(prepared.browsersPath, resolve(prepared.browserPath!));
      assert.ok(browserRel !== ".." && !browserRel.startsWith(`..${sep}`) && !isAbsolute(browserRel), "managed Chromium escaped its isolated cache");
      assert.ok((await lstat(prepared.browserPath!)).isFile(), "managed Chromium executable is missing");
      if (platform !== "win32") await access(prepared.browserPath!, fsConstants.X_OK);
    } else {
      const warning = browserWarnings.find((message) => message.includes("HTTP-only fetching"));
      assert.ok(warning, "missing Chromium must report the HTTP-only warning");
      report.browserWarning = warning;
    }

    const mcpEnv: NodeJS.ProcessEnv = { ...isolatedEnv, ...prepared.environment };
    assert.equal(mcpEnv.HOME, prepared.homePath, "MCP subprocess HOME is not isolated");
    assert.equal(mcpEnv.PLAYWRIGHT_BROWSERS_PATH, prepared.browsersPath, "MCP subprocess Chromium path is not isolated");
    assert.equal(Object.keys(mcpEnv).some(secretEnvironmentKey), false, "MCP subprocess environment contains search credentials");

    stage = "managed Python verification";
    const pythonProbe = [
      "import importlib.metadata as metadata",
      "import json, pathlib, sys, master_fetch",
      "print(json.dumps({'python': [sys.version_info.major, sys.version_info.minor], 'hound': metadata.version('hound-mcp'), 'module': str(pathlib.Path(master_fetch.__file__).resolve())}))",
    ].join("; ");
    const pythonResult = JSON.parse(await runCapture(prepared.pythonPath, ["-c", pythonProbe], mcpDirectory, mcpEnv, controller.signal, stage)) as {
      python?: number[];
      hound?: string;
      module?: string;
    };
    assert.deepEqual(pythonResult.python, [3, 12], "managed interpreter is not Python 3.12");
    assert.equal(pythonResult.hound, "12.4.1", "installed Hound distribution is not 12.4.1");
    assert.equal(typeof pythonResult.module, "string", "managed master_fetch module path is missing");
    const moduleRel = relative(resolve(prepared.runtimeDirectory, "env"), resolve(pythonResult.module!));
    assert.ok(moduleRel !== ".." && !moduleRel.startsWith(`..${sep}`) && !isAbsolute(moduleRel), "master_fetch was not imported from the managed frozen environment");

    stage = "compiled plugin MCP registration";
    const compiled = await import(pathToFileURL(join(distDirectory, "index.js")).href) as { default: Plugin.Plugin };
    let transform: ((editor: MCPEditor) => void) | undefined;
    let servers = new Map<string, NonNullable<ReturnType<MCPEditor["get"]>>>();
    let readyResolve!: () => void;
    const ready = new Promise<void>((resolvePromise) => { readyResolve = resolvePromise; });
    const replay = () => {
      servers = new Map();
      transform!({
        list: () => [...servers], get: (name) => servers.get(name),
        set: (name, config) => { servers.set(name, structuredClone(config) as NonNullable<ReturnType<MCPEditor["get"]>>); },
        update: (name, update) => { const config = servers.get(name); if (config) update(config); },
        remove: (name) => { servers.delete(name); },
      });
      if (servers.has("hound")) readyResolve();
    };
    await withoutSearchSecrets(async () => {
      pluginCleanup = await compiled.default.setup({
        options: { mcpCacheDirectory: join(tempRoot, "cache"), exaApiKeyFile: join(tempRoot, "missing-exa-key") },
        location: { directory: tempRoot },
        tool: { transform: async () => {} }, skill: { transform: async () => {} },
        agent: { transform: async () => {} }, command: { transform: async () => {} },
        mcp: {
          transform: async (callback: (editor: MCPEditor) => void) => { transform = callback; },
          reload: async () => { replay(); },
        },
      } as unknown as Plugin.Context);
      // Match the native host's deferred, post-setup transform execution.
      replay();
      const timeout = setTimeout(() => readyResolve(), 30_000);
      try { await ready; } finally { clearTimeout(timeout); }
    });
    assert.equal(servers.has("exa"), false, "Compiled plugin registered Exa without a key");
    const researcherConfig = servers.get("researcher-mcp");
    const houndConfig = servers.get("hound");
    assert.ok(researcherConfig?.type === "local" && houndConfig?.type === "local", "Compiled plugin did not automatically register both local MCPs");
    assert.deepEqual(researcherConfig.command, [executable]);
    assert.deepEqual(houndConfig.command, [prepared.pythonPath, "-m", "master_fetch"]);
    report.compiledPluginMcp = "registered-after-deferred-transform";

    stage = "Researcher MCP stdio catalog";
    const researcherTools = await listMcpTools("researcher-mcp", researcherConfig.command[0]!, researcherConfig.command.slice(1), researcherConfig.cwd!, mcpEnv, controller.signal);
    assertTools("researcher-mcp", researcherTools, RESEARCHER_TOOLS);
    report.researcherTools = researcherTools.length;

    stage = "Hound MCP stdio catalog";
    const houndTools = await listMcpTools("Hound", houndConfig.command[0]!, houndConfig.command.slice(1), houndConfig.cwd!, { ...mcpEnv, ...houndConfig.environment }, controller.signal);
    assertTools("Hound", houndTools, HOUND_TOOLS);
    report.houndTools = houndTools.length;
  } finally {
    await pluginCleanup?.();
    clearTimeout(totalTimeout);
    assert.equal(await hashFile(lockPath), lockShaBefore, "packaged input uv.lock changed during MCP smoke checks");
    const [distAfter, workspaceAfter] = await Promise.all([
      (async () => {
        const result: Snapshot = new Map();
        await addTree(result, distDirectory, "dist");
        return result;
      })(),
      snapshotWorkspaceArtifacts(ROOT),
    ]);
    const allChanges = [...changedPaths(distBefore, distAfter), ...changedPaths(workspaceBefore, workspaceAfter)];
    upstreamHatchCacheChanges = [...new Set(allChanges.filter(isHatchCache))].sort();
    assert.deepEqual(allChanges, [], "unexpected packaged/workspace lock, .venv, Hatch cache or build artifact changes");
  }

  console.log(JSON.stringify({ ok: true, ...report, upstreamHatchCacheChanges }));
}

let stage = "preflight";
try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(JSON.stringify({ ok: false, stage, error: message, ...report, upstreamHatchCacheChanges }));
  process.exitCode = 1;
}

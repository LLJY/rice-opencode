import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "@opencode/plugin";

const RESEARCHER = "researcher-mcp";
const HOUND = "hound";
const EXA = "exa";
const EXA_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa";
const HOUND_SOURCE_PIN = "1dab81b7fc03721688cfb7775fc1222c7f9805ba";
const PYTHON_VERSION = "3.12";
const MCP_TIMEOUT = { startup: 120_000, catalog: 120_000, execution: 120_000 };
const LOCK_WAIT_MS = 600_000;
const LOCK_POLL_MS = 100;
const STALE_LOCK_MS = 60_000;
const KILL_TIMEOUT_MS = 1_500;

type ProcessOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  captureStdout?: boolean;
};

export type ProcessRunner = (
  command: string,
  args: string[],
  options: ProcessOptions,
) => Promise<string | void>;

export interface HoundRuntime {
  runtimeDirectory: string;
  pythonPath: string;
  browsersPath: string;
  homePath: string;
  environment: Record<string, string>;
}

export interface PreparedHound extends HoundRuntime {
  browserPath?: string;
}

export interface HoundRunnerOptions {
  run?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  warn?: (message: string) => void;
  onPythonReady?: (runtime: HoundRuntime) => void | Promise<void>;
  lockWaitMs?: number;
  lockPollMs?: number;
}

export type HoundRunner = HoundRunnerOptions | ProcessRunner;

export interface McpDependencies extends Omit<HoundRunnerOptions, "onPythonReady" | "lockWaitMs" | "lockPollMs"> {
  homeDirectory?: string;
}

type CacheIdentity = {
  markerVersion: 1;
  lockDigest: string;
  manifestDigest: string;
  sourcePin: string;
  platform: string;
  arch: string;
  pythonVersion: string;
};

function stderrWarning(message: string): void {
  process.stderr.write(`${message}\n`);
}

function makeWarning(warn?: (message: string) => void): (message: string) => void {
  const output = warn ?? stderrWarning;
  return (message) => {
    try {
      output(message);
    } catch {
      // Diagnostics must not break plugin startup.
    }
  };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function runProcess(command: string, args: string[], options: ProcessOptions): Promise<string | void> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (options.signal.aborted) {
      rejectPromise(abortError(options.signal));
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "ignore"],
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }

    let output = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    if (options.captureStdout) child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });

    const cleanup = () => {
      options.signal.removeEventListener("abort", onAbort);
      if (killTimer) clearTimeout(killTimer);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      if (!child.kill("SIGTERM")) return;
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_TIMEOUT_MS);
      killTimer.unref?.();
    };

    options.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => finish(() => rejectPromise(error)));
    child.once("close", (code) => finish(() => {
      if (options.signal.aborted) rejectPromise(abortError(options.signal));
      else if (code === 0) resolvePromise(options.captureStdout ? output : undefined);
      else rejectPromise(new Error(`Process exited with code ${code ?? "unknown"}`));
    }));
    if (options.signal.aborted) onAbort();
  });
}

function isRunnableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== "win32") accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function withinDirectory(directory: string, path: string): boolean {
  const rel = relative(directory, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeJsonAtomically(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function matchesIdentity(value: Record<string, unknown> | undefined, identity: CacheIdentity): boolean {
  return value !== undefined && Object.entries(identity).every(([key, expected]) => value[key] === expected);
}

function pythonExecutable(environmentDirectory: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? join(environmentDirectory, "Scripts", "python.exe")
    : join(environmentDirectory, "bin", "python");
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function staleLock(lockDirectory: string): boolean {
  const owner = readJson(join(lockDirectory, "owner.json"));
  const pid = owner?.pid;
  if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0) return !processAlive(pid);
  try {
    return Date.now() - statSync(lockDirectory).mtimeMs > STALE_LOCK_MS;
  } catch {
    return true;
  }
}

function reclaimStaleLock(lockDirectory: string): boolean {
  if (!staleLock(lockDirectory)) return false;
  const tombstone = `${lockDirectory}.stale-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    renameSync(lockDirectory, tombstone);
  } catch {
    return false;
  }

  if (staleLock(tombstone)) {
    rmSync(tombstone, { recursive: true, force: true });
    return true;
  }
  try {
    renameSync(tombstone, lockDirectory);
  } catch {
    // A concurrent owner may already hold the canonical lock path; never
    // delete the moved directory unless its owner was proven stale.
  }
  return false;
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal.aborted) {
      rejectPromise(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolvePromise();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      rejectPromise(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitAbortable(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}

async function acquireCacheLock(
  lockDirectory: string,
  signal: AbortSignal,
  waitLimit: number,
  pollInterval: number,
): Promise<() => void> {
  const started = Date.now();
  const token = randomBytes(16).toString("hex");

  while (true) {
    throwIfAborted(signal);
    let created = false;
    try {
      mkdirSync(lockDirectory);
      created = true;
      writeJsonAtomically(join(lockDirectory, "owner.json"), { pid: process.pid, token });
      const owner = readJson(join(lockDirectory, "owner.json"));
      if (owner?.token === token) {
        return () => {
          const currentOwner = readJson(join(lockDirectory, "owner.json"));
          if (currentOwner?.token === token) rmSync(lockDirectory, { recursive: true, force: true });
        };
      }
    } catch (error) {
      const owner = readJson(join(lockDirectory, "owner.json"));
      if (created && owner?.token === token) rmSync(lockDirectory, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (reclaimStaleLock(lockDirectory)) continue;
    if (Date.now() - started >= waitLimit) throw new Error("Timed out waiting for the Hound cache lock");
    await waitFor(Math.min(pollInterval, waitLimit - (Date.now() - started)), signal);
  }
}

function runtimePaths(cacheDirectory: string, platform: NodeJS.Platform): HoundRuntime {
  const environmentDirectory = join(cacheDirectory, "env");
  const browsersPath = join(cacheDirectory, "browsers");
  const homePath = join(cacheDirectory, "home");
  return {
    runtimeDirectory: cacheDirectory,
    pythonPath: pythonExecutable(environmentDirectory, platform),
    browsersPath,
    homePath,
    environment: {
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
      HOME: homePath,
      ...(platform === "win32" ? { USERPROFILE: homePath } : {}),
    },
  };
}

function matchingPythonReady(
  path: string,
  identity: CacheIdentity,
  expectedPython: string,
  platform: NodeJS.Platform,
): boolean {
  const marker = readJson(path);
  return marker?.pythonPath === expectedPython && matchesIdentity(marker, identity) && isRunnableFile(expectedPython, platform);
}

function matchingBrowserReady(
  path: string,
  identity: CacheIdentity,
  browsersPath: string,
  platform: NodeJS.Platform,
): string | undefined {
  const marker = readJson(path);
  const browserPath = marker?.browserPath;
  if (typeof browserPath !== "string" || !isAbsolute(browserPath)) return undefined;
  const absoluteBrowserPath = resolve(browserPath);
  if (!matchesIdentity(marker, identity) || !withinDirectory(browsersPath, absoluteBrowserPath)) return undefined;
  return isRunnableFile(absoluteBrowserPath, platform) ? absoluteBrowserPath : undefined;
}

/**
 * Prepare the pinned Hound Python environment outside MCP connection startup.
 * The optional runner is intended for deterministic offline checks and exposes
 * onPythonReady so MCP can be enabled before the best-effort browser download.
 */
export async function prepareHound(
  projectDir: string,
  cacheDir: string,
  signal: AbortSignal,
  runnerInput: HoundRunner = {},
): Promise<PreparedHound> {
  const runner: HoundRunnerOptions = typeof runnerInput === "function" ? { run: runnerInput } : runnerInput;
  const platform = runner.platform ?? process.platform;
  const arch = runner.arch ?? process.arch;
  if (!["linux", "darwin", "win32"].includes(platform) || !["x64", "arm64"].includes(arch)) {
    throw new Error("Unsupported Hound runtime platform");
  }

  const projectDirectory = resolve(projectDir);
  const cacheDirectory = resolve(cacheDir);
  const lockPath = join(projectDirectory, "uv.lock");
  const manifestPath = join(projectDirectory, "pyproject.toml");
  const lockDigest = sha256(readFileSync(lockPath, "utf8"));
  const manifestDigest = sha256(readFileSync(manifestPath, "utf8"));
  const identity: CacheIdentity = {
    markerVersion: 1,
    lockDigest,
    manifestDigest,
    sourcePin: HOUND_SOURCE_PIN,
    platform,
    arch,
    pythonVersion: PYTHON_VERSION,
  };
  const runtimeDirectory = join(cacheDirectory, `hound-${sha256(JSON.stringify(identity))}`);
  const runtime = runtimePaths(runtimeDirectory, platform);
  const pythonMarkerPath = join(runtimeDirectory, "python-ready.json");
  const browserMarkerPath = join(runtimeDirectory, "browser-ready.json");
  // ponytail: one per-runtime lock serializes equivalent installs; split it if contention matters.
  const lockDirectory = join(runtimeDirectory, ".setup.lock");
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...runner.env };
  const uvEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    UV_PROJECT_ENVIRONMENT: join(runtimeDirectory, "env"),
    UV_CACHE_DIR: join(runtimeDirectory, "uv"),
    UV_PYTHON_INSTALL_DIR: join(runtimeDirectory, "python"),
    HOME: runtime.homePath,
    ...(platform === "win32" ? { USERPROFILE: runtime.homePath } : {}),
  };
  const run = runner.run ?? runProcess;
  const warn = makeWarning(runner.warn);
  const release = await (async () => {
    mkdirSync(runtimeDirectory, { recursive: true });
    mkdirSync(uvEnv.UV_CACHE_DIR!, { recursive: true });
    mkdirSync(uvEnv.UV_PYTHON_INSTALL_DIR!, { recursive: true });
    mkdirSync(runtime.homePath, { recursive: true });
    mkdirSync(runtime.browsersPath, { recursive: true });
    return acquireCacheLock(lockDirectory, signal, runner.lockWaitMs ?? LOCK_WAIT_MS, runner.lockPollMs ?? LOCK_POLL_MS);
  })();

  try {
    throwIfAborted(signal);
    if (!matchingPythonReady(pythonMarkerPath, identity, runtime.pythonPath, platform)) {
      rmSync(pythonMarkerPath, { force: true });
      try {
        await run("uv", ["sync", "--project", projectDirectory, "--frozen", "--no-dev", "--no-editable", "--python", PYTHON_VERSION], {
          cwd: projectDirectory,
          env: uvEnv,
          signal,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new Error("UV_EXECUTABLE_MISSING");
        throw error;
      }
      throwIfAborted(signal);
      if (!isRunnableFile(runtime.pythonPath, platform)) throw new Error("uv did not create the managed Python executable");
      writeJsonAtomically(pythonMarkerPath, { ...identity, pythonPath: runtime.pythonPath });
    }

    throwIfAborted(signal);
    await waitAbortable(Promise.resolve(runner.onPythonReady?.(runtime)), signal);
    throwIfAborted(signal);

    try {
      const cachedBrowser = matchingBrowserReady(browserMarkerPath, identity, runtime.browsersPath, platform);
      if (cachedBrowser) return { ...runtime, browserPath: cachedBrowser };

      rmSync(browserMarkerPath, { force: true });
      const browserEnv = { ...uvEnv, ...runtime.environment };
      const output = await run(runtime.pythonPath, [
        "-c",
        "from patchright.sync_api import sync_playwright; p = sync_playwright().start(); print(p.chromium.executable_path); p.stop()",
      ], { cwd: projectDirectory, env: browserEnv, signal, captureStdout: true });
      throwIfAborted(signal);
      const expectedExecutable = typeof output === "string" ? output.trim().split(/\r?\n/).filter(Boolean).at(-1) : undefined;
      if (!expectedExecutable || !isAbsolute(expectedExecutable)) throw new Error("Could not resolve the managed Chromium executable");
      const browserPath = resolve(expectedExecutable);
      if (!withinDirectory(runtime.browsersPath, browserPath)) throw new Error("Chromium executable is outside the managed browser cache");

      if (!isRunnableFile(browserPath, platform)) {
        await run(runtime.pythonPath, ["-m", "patchright", "install", "chromium"], {
          cwd: projectDirectory,
          env: browserEnv,
          signal,
        });
      }
      throwIfAborted(signal);
      if (!isRunnableFile(browserPath, platform)) throw new Error("Chromium installation did not create its expected executable");
      writeJsonAtomically(browserMarkerPath, { ...identity, browserPath });
      return { ...runtime, browserPath };
    } catch (error) {
      if (signal.aborted) throw error;
      warn("[rice-opencode] Hound browser setup failed; Hound remains available for HTTP-only fetching.");
      return runtime;
    }
  } finally {
    release();
  }
}

function cacheDirectoryFor(
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
  platform: NodeJS.Platform,
  warn: (message: string) => void,
): string {
  const requested = options.mcpCacheDirectory;
  if (typeof requested === "string" && requested.length > 0) {
    if (isAbsolute(requested)) return resolve(requested);
    warn("[rice-opencode] mcpCacheDirectory must be absolute; using the default user cache.");
  }
  const xdgCache = env.XDG_CACHE_HOME;
  const platformCache = platform === "win32"
    ? (env.LOCALAPPDATA && isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : join(homeDirectory, "AppData", "Local"))
    : platform === "darwin"
      ? join(homeDirectory, "Library", "Caches")
      : join(homeDirectory, ".cache");
  const cacheBase = typeof xdgCache === "string" && isAbsolute(xdgCache) ? xdgCache : platformCache;
  return join(cacheBase, "opencode", "rice-opencode-mcp");
}

function resolveExaKey(
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): string | undefined {
  const environmentKey = env.EXA_API_KEY?.trim();
  if (environmentKey) return environmentKey;

  const configuredPath = options.exaApiKeyFile;
  const keyPath = typeof configuredPath === "string" && configuredPath.length > 0
    ? resolve(configuredPath)
    : join(homeDirectory, ".config", "opencode", ".exa-api-key");
  try {
    const fileKey = readFileSync(keyPath, "utf8").trim();
    return fileKey || undefined;
  } catch {
    return undefined;
  }
}

function researcherBinary(distDirectory: string, platform: NodeJS.Platform, arch: string): string | undefined {
  if (!["linux", "darwin", "win32"].includes(platform) || !["x64", "arm64"].includes(arch)) return undefined;
  const executable = join(distDirectory, "mcp", "bin", `${platform}-${arch}`, `researcher-mcp${platform === "win32" ? ".exe" : ""}`);
  return isRunnableFile(executable, platform) ? executable : undefined;
}

/** Register plugin-managed MCP configs and return a non-blocking abort cleanup. */
export async function registerMcp(
  context: Plugin.Context,
  distDirectory: string,
  deps: McpDependencies = {},
): Promise<Plugin.Cleanup | void> {
  const options = context.options as Record<string, unknown>;
  if (options.mcp === false) return;

  const env = deps.env ?? process.env;
  const configuredHome = [deps.homeDirectory, env.HOME, env.USERPROFILE, homedir()]
    .find((path): path is string => typeof path === "string" && path.trim().length > 0)!;
  const homeDirectory = resolve(configuredHome);
  const warn = makeWarning(deps.warn);
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(message);
  };
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const packageDirectory = resolve(distDirectory, "mcp");
  const projectDirectory = resolve(context.location.directory);
  const controller = new AbortController();
  let disposed = false;
  let houndRuntime: HoundRuntime | undefined;
  let houndReady = false;
  let houndOwnedByHost = false;
  let houndSetupScheduled = false;
  let exaKeyChecked = false;
  let exaKey: string | undefined;

  const startHoundSetup = () => {
    if (disposed || controller.signal.aborted || houndSetupScheduled || houndOwnedByHost) return;
    houndSetupScheduled = true;
    queueMicrotask(() => {
      if (disposed || controller.signal.aborted) return;
      if (houndOwnedByHost) {
        houndSetupScheduled = false;
        return;
      }
      try {
        const backgroundSetup = prepareHound(packageDirectory, cacheDirectoryFor(
          options,
          env,
          homeDirectory,
          platform,
          (message) => warnOnce("cache", message),
        ), controller.signal, {
          ...deps,
          onPythonReady: (runtime) => {
            if (disposed || controller.signal.aborted) return;
            houndRuntime = runtime;
            houndReady = true;
            if (houndOwnedByHost) return;
            const backgroundReload = Promise.resolve().then(() => {
              if (disposed || controller.signal.aborted) return;
              return context.mcp.reload();
            }).catch(() => {
              if (!disposed) warnOnce("hound-reload", "[rice-opencode] Hound is prepared, but MCP reload failed; it will be available after the next MCP reload.");
            });
            void backgroundReload.catch(() => {});
          },
        }).catch((error: unknown) => {
          if (disposed) return;
          const message = error instanceof Error && error.message === "UV_EXECUTABLE_MISSING"
            ? "[rice-opencode] Hound setup failed: uv was not found on PATH; install uv to enable Hound."
            : "[rice-opencode] Hound setup failed; verify uv, Python 3.12, and platform wheel support. Hound is unavailable; other tools remain available.";
          warnOnce("hound-setup", message);
        });
        void backgroundSetup.catch(() => {});
      } catch {
        if (!disposed) warnOnce("hound-setup", "[rice-opencode] Hound setup could not be started; other tools remain available.");
      }
    });
  };

  const transformRegistration = context.mcp.transform((editor) => {
    if (!editor.get(RESEARCHER)) {
      const executable = researcherBinary(resolve(distDirectory), platform, arch);
      if (!executable) {
        warnOnce("researcher", "[rice-opencode] Researcher MCP binary is unavailable for this platform; the server was not registered.");
      } else {
        const sourceDirectory = join(packageDirectory, "vendor", "researcher-mcp");
        editor.set(RESEARCHER, {
          type: "local",
          command: [executable],
          cwd: isDirectory(sourceDirectory) ? sourceDirectory : projectDirectory,
          codemode: false,
          timeout: MCP_TIMEOUT,
        });
      }
    }

    if (!editor.get(EXA)) {
      if (!exaKeyChecked) {
        exaKey = resolveExaKey(options, env, homeDirectory);
        exaKeyChecked = true;
      }
      if (exaKey) {
        editor.set(EXA, {
          type: "remote",
          url: EXA_URL,
          oauth: false,
          codemode: false,
          headers: { "x-api-key": exaKey },
        });
      } else {
        warnOnce("exa-key", "[rice-opencode] Exa MCP is unavailable; set EXA_API_KEY or provide a nonempty .exa-api-key file.");
      }
    }

    houndOwnedByHost = Boolean(editor.get(HOUND));
    if (houndOwnedByHost) return;
    startHoundSetup();
    if (!disposed && houndReady && houndRuntime) {
      editor.set(HOUND, {
        type: "local",
        command: [houndRuntime.pythonPath, "-m", "master_fetch"],
        cwd: projectDirectory,
        environment: houndRuntime.environment,
        codemode: false,
        timeout: MCP_TIMEOUT,
      });
    }
  });
  await transformRegistration;

  return () => {
    disposed = true;
    controller.abort();
  };
}

import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { Plugin } from "@opencode/plugin";

import { prepareHound, registerMcp, type ProcessRunner } from "./mcp";

type TestServer = { type: string; [key: string]: unknown };
type Editor = {
  list(): [string, TestServer][];
  get(name: string): TestServer | undefined;
  set(name: string, config: TestServer): void;
  update(name: string, update: (config: TestServer) => void): void;
  remove(name: string): void;
};

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "rice-mcp-"));
  directories.push(directory);
  return directory;
}

function fixture() {
  const root = tempDirectory();
  const dist = join(root, "dist");
  const project = join(root, "project");
  const packageDirectory = join(dist, "mcp");
  mkdirSync(join(packageDirectory, "vendor", "researcher-mcp"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(packageDirectory, "pyproject.toml"), "[project]\nname = 'test-mcp'\n");
  writeFileSync(join(packageDirectory, "uv.lock"), "version = 1\nrevision = 3\n");
  return { root, dist, packageDirectory, project, cache: join(root, "cache") };
}

function runtimeDirectory(projectDirectory: string, cacheDirectory: string): string {
  const lockDigest = createHash("sha256").update(readFileSync(join(projectDirectory, "uv.lock"))).digest("hex");
  const manifestDigest = createHash("sha256").update(readFileSync(join(projectDirectory, "pyproject.toml"))).digest("hex");
  const identity = {
    markerVersion: 1,
    lockDigest,
    manifestDigest,
    sourcePin: "1dab81b7fc03721688cfb7775fc1222c7f9805ba",
    platform: process.platform,
    arch: process.arch,
    pythonVersion: "3.12",
  };
  const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return join(cacheDirectory, `hound-${digest}`);
}

function addResearcherBinary(dist: string, platform = process.platform, arch = process.arch): string {
  const directory = join(dist, "mcp", "bin", `${platform}-${arch}`);
  mkdirSync(directory, { recursive: true });
  const binary = join(directory, `researcher-mcp${platform === "win32" ? ".exe" : ""}`);
  writeFileSync(binary, "test executable");
  if (platform !== "win32") chmodSync(binary, 0o755);
  return binary;
}

function contextFixture(
  projectDirectory: string,
  options: Record<string, unknown> = {},
  initialServers: Record<string, TestServer> = {},
  delayedTransform = false,
  reload: () => Promise<void> = async () => {},
) {
  const hostServers = new Map(Object.entries(initialServers).map(([name, config]) => [name, structuredClone(config)]));
  let servers = new Map<string, TestServer>();
  const transforms: Array<(editor: Editor) => void> = [];
  let transformCalls = 0;
  let transformExecutions = 0;
  let reloadCalls = 0;

  const applyTransforms = () => {
    servers = new Map([...hostServers].map(([name, config]) => [name, structuredClone(config)]));
    const editor: Editor = {
      list: () => [...servers.entries()],
      get: (name) => servers.get(name),
      set: (name, config) => { servers.set(name, config); },
      update: (name, update) => {
        const current = servers.get(name);
        if (current) update(current);
      },
      remove: (name) => { servers.delete(name); },
    };
    for (const transform of transforms) {
      transformExecutions += 1;
      transform(editor);
    }
  };

  const context = {
    options,
    location: {
      directory: projectDirectory,
      project: { directory: projectDirectory },
    },
    mcp: {
      async transform(callback: (editor: Editor) => void) {
        transformCalls += 1;
        transforms.push(callback);
        if (!delayedTransform) applyTransforms();
        return { dispose() {} };
      },
      async reload() {
        reloadCalls += 1;
        applyTransforms();
        await reload();
      },
    },
  } as unknown as Plugin.Context;

  return {
    context,
    hostServers,
    servers: () => servers,
    applyTransforms,
    get transformCalls() { return transformCalls; },
    get transformExecutions() { return transformExecutions; },
    get reloadCalls() { return reloadCalls; },
  };
}

function makeRunner(options: { failBrowserInstall?: boolean; events?: string[] } = {}) {
  const calls: Array<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
  const browserPath = (env: NodeJS.ProcessEnv) => join(env.PLAYWRIGHT_BROWSERS_PATH!, "chromium-test", "chrome");
  const run: ProcessRunner = async (command, args, runOptions) => {
    calls.push({ command, args, cwd: runOptions.cwd, env: runOptions.env });
    if (options.events) options.events.push(command === "uv" ? "uv" : args.includes("install") ? "browser-install" : "browser-query");

    if (command === "uv") {
      const python = runOptions.env.UV_PROJECT_ENVIRONMENT!;
      const executable = process.platform === "win32"
        ? join(python, "Scripts", "python.exe")
        : join(python, "bin", "python");
      mkdirSync(resolve(executable, ".."), { recursive: true });
      writeFileSync(executable, "fake python");
      if (process.platform !== "win32") chmodSync(executable, 0o755);
      return;
    }

    if (args[0] === "-c") return browserPath(runOptions.env);
    if (options.failBrowserInstall) throw new Error("browser install failed");
    const executable = browserPath(runOptions.env);
    mkdirSync(resolve(executable, ".."), { recursive: true });
    writeFileSync(executable, "fake chromium");
    if (process.platform !== "win32") chmodSync(executable, 0o755);
  };
  return { calls, run, browserPath };
}

function deferred() {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe("native MCP lifecycle", () => {
  it("starts the managed Hound after a host entry is removed on reload", async () => {
    const paths = fixture();
    const host = contextFixture(paths.project, { mcpCacheDirectory: paths.cache }, {
      hound: { type: "local", command: ["host-hound"], disabled: true },
      "researcher-mcp": { type: "local", command: ["host-researcher"] },
      exa: { type: "remote", url: "https://mcp.exa.ai/mcp" },
    });
    const ready = deferred();
    const runner = makeRunner();
    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { HOME: paths.root },
      warn: () => {},
      run: async (command, args, options) => {
        const output = await runner.run(command, args, options);
        if (args.includes("install")) ready.resolve();
        return output;
      },
    });
    expect(runner.calls).toHaveLength(0);
    host.hostServers.delete("hound");
    host.applyTransforms();
    await ready.promise;
    const python = join(runtimeDirectory(paths.packageDirectory, paths.cache), "env", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    expect(host.servers().get("hound")?.command).toEqual([python, "-m", "master_fetch"]);
    expect(host.reloadCalls).toBe(1);
    await cleanup?.();
  });

  it("mcp:false opts out before registering, reading credentials, or provisioning", async () => {
    const paths = fixture();
    const host = contextFixture(paths.project, { mcp: false, exaApiKeyFile: join(paths.root, "missing-key") });
    const warnings: string[] = [];
    let processCalls = 0;

    expect(await registerMcp(host.context, paths.dist, {
      run: async () => { processCalls += 1; },
      warn: (message) => warnings.push(message),
    })).toBeUndefined();
    expect(host.transformCalls).toBe(0);
    expect(processCalls).toBe(0);
    expect(warnings).toEqual([]);
    expect(() => readFileSync(join(paths.root, "missing-key"))).toThrow();
  });

  it("uses EXA_API_KEY before the explicit key file and installs absolute researcher stdio config", async () => {
    const paths = fixture();
    const researcher = addResearcherBinary(paths.dist);
    const keyFile = join(paths.root, "key");
    writeFileSync(keyFile, "file-secret\n");
    const host = contextFixture(paths.project, { exaApiKeyFile: keyFile }, { hound: { type: "local", disabled: true } });
    const warnings: string[] = [];
    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { HOME: paths.root, EXA_API_KEY: "env-secret" },
      warn: (message) => warnings.push(message),
    });

    const servers = host.servers();
    expect(host.transformCalls).toBe(1);
    expect(servers.get("researcher-mcp")).toEqual({
      type: "local",
      command: [researcher],
      cwd: join(paths.packageDirectory, "vendor", "researcher-mcp"),
      codemode: false,
      timeout: { startup: 120_000, catalog: 120_000, execution: 120_000 },
    });
    expect(servers.get("exa")).toEqual({
      type: "remote",
      url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
      oauth: false,
      codemode: false,
      headers: { "x-api-key": "env-secret" },
    });
    expect(servers.get("hound")).toEqual({ type: "local", disabled: true });
    expect(warnings.join(" ")).not.toContain("env-secret");
    expect(warnings.join(" ")).not.toContain("file-secret");
    expect(warnings).toEqual([]);
    await cleanup?.();
  });

  it("falls back to an explicit key file and never registers Exa anonymously", async () => {
    const paths = fixture();
    addResearcherBinary(paths.dist);
    const keyFile = join(paths.root, "exa-key");
    writeFileSync(keyFile, "  file-secret  \n");
    const host = contextFixture(paths.project, { exaApiKeyFile: keyFile }, { hound: { type: "local" } });
    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { HOME: paths.root },
      warn: () => {},
    });
    expect(host.servers().get("exa")).toMatchObject({ headers: { "x-api-key": "file-secret" } });
    await cleanup?.();

    const defaultKeyDirectory = join(paths.root, ".config", "opencode");
    mkdirSync(defaultKeyDirectory, { recursive: true });
    writeFileSync(join(defaultKeyDirectory, ".exa-api-key"), "default-file-secret\n");
    const defaultHost = contextFixture(paths.project, {}, { hound: { type: "local" } });
    const defaultCleanup = await registerMcp(defaultHost.context, paths.dist, {
      env: { HOME: paths.root },
      warn: () => {},
    });
    expect(defaultHost.servers().get("exa")).toMatchObject({ headers: { "x-api-key": "default-file-secret" } });
    await defaultCleanup?.();

    writeFileSync(keyFile, " \n\t");
    const blankHost = contextFixture(paths.project, { exaApiKeyFile: keyFile }, { hound: { type: "local" } });
    const warnings: string[] = [];
    const blankCleanup = await registerMcp(blankHost.context, paths.dist, {
      env: { HOME: paths.root, EXA_API_KEY: " " },
      warn: (message) => warnings.push(message),
    });
    expect(blankHost.servers().has("exa")).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Exa MCP is unavailable");
    expect(warnings.join(" ")).not.toContain("file-secret");
    await blankCleanup?.();

    const unreadableHost = contextFixture(paths.project, { exaApiKeyFile: join(paths.root, "missing-key") }, { hound: { type: "local" } });
    const unreadableWarnings: string[] = [];
    const unreadableCleanup = await registerMcp(unreadableHost.context, paths.dist, {
      env: { HOME: paths.root },
      warn: (message) => unreadableWarnings.push(message),
    });
    expect(unreadableHost.servers().has("exa")).toBe(false);
    expect(unreadableWarnings).toHaveLength(1);
    expect(unreadableWarnings[0]).toContain("Exa MCP is unavailable");
    await unreadableCleanup?.();
  });

  it("preserves disabled host entries and skips key reads and Hound provisioning", async () => {
    const paths = fixture();
    const hostEntries = {
      "researcher-mcp": { type: "local", command: ["host-owned"], disabled: true },
      hound: { type: "local", command: ["host-hound"], disabled: true },
      exa: { type: "remote", url: "https://host-owned.invalid", disabled: true },
    };
    const host = contextFixture(paths.project, { exaApiKeyFile: join(paths.root, "does-not-exist") }, hostEntries);
    const warnings: string[] = [];
    let processCalls = 0;
    const cleanup = await registerMcp(host.context, paths.dist, {
      run: async () => { processCalls += 1; },
      warn: (message) => warnings.push(message),
    });

    expect(host.transformCalls).toBe(1);
    expect(host.servers()).toEqual(new Map(Object.entries(hostEntries)));
    expect(processCalls).toBe(0);
    expect(warnings).toEqual([]);
    await cleanup?.();
  });

  it("warns for missing researcher assets and unsupported Hound platforms without failing registration", async () => {
    const paths = fixture();
    const host = contextFixture(paths.project, {}, { hound: { type: "local", disabled: true } });
    const warnings: string[] = [];
    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { HOME: paths.root, EXA_API_KEY: "test-key" },
      warn: (message) => warnings.push(message),
    });
    expect(host.servers().has("researcher-mcp")).toBe(false);
    expect(warnings.some((message) => message.includes("Researcher MCP binary is unavailable"))).toBe(true);
    expect(host.servers().has("exa")).toBe(true);
    expect(host.servers().get("hound")).toEqual({ type: "local", disabled: true });
    await cleanup?.();

    const unsupported = contextFixture(paths.project);
    const unsupportedWarnings: string[] = [];
    const houndSetupWarning = deferred();
    let processCalls = 0;
    const unsupportedCleanup = await registerMcp(unsupported.context, paths.dist, {
      platform: "freebsd" as NodeJS.Platform,
      arch: "x64",
      env: { HOME: paths.root, EXA_API_KEY: "test-key" },
      run: async () => { processCalls += 1; },
      warn: (message) => {
        unsupportedWarnings.push(message);
        if (message.includes("Hound setup failed")) houndSetupWarning.resolve();
      },
    });
    await houndSetupWarning.promise;
    expect(processCalls).toBe(0);
    expect(unsupported.servers().has("hound")).toBe(false);
    expect(unsupportedWarnings.some((message) => message.includes("Researcher MCP binary is unavailable"))).toBe(true);
    await unsupportedCleanup?.();
  });

  it("returns before Hound setup, enables its direct Python command at Python-ready, and tolerates browser failure", async () => {
    const paths = fixture();
    const researcher = addResearcherBinary(paths.dist);
    const keyFile = join(paths.root, "blank-key");
    writeFileSync(keyFile, " \n");
    const host = contextFixture(paths.project, { exaApiKeyFile: keyFile, mcpCacheDirectory: paths.cache }, {}, true);
    const uvStarted = deferred();
    const finishUv = deferred();
    const browserFailed = deferred();
    const browserWarning = deferred();
    const warnings: string[] = [];
    const calls: string[] = [];
    const pathsByEnvironment = makeRunner({ failBrowserInstall: true });
    const run: ProcessRunner = async (command, args, options) => {
      calls.push(command === "uv" ? "uv" : args.includes("install") ? "browser-install" : "browser-query");
      if (command === "uv") {
        uvStarted.resolve();
        await new Promise<void>((resolvePromise, rejectPromise) => {
          const onAbort = () => rejectPromise(options.signal.reason ?? new Error("aborted"));
          options.signal.addEventListener("abort", onAbort, { once: true });
          finishUv.promise.then(() => {
            options.signal.removeEventListener("abort", onAbort);
            const env = options.env.UV_PROJECT_ENVIRONMENT!;
            const python = process.platform === "win32" ? join(env, "Scripts", "python.exe") : join(env, "bin", "python");
            mkdirSync(resolve(python, ".."), { recursive: true });
            writeFileSync(python, "fake python");
            if (process.platform !== "win32") chmodSync(python, 0o755);
            resolvePromise();
          });
        });
        return;
      }
      if (args[0] === "-c") return pathsByEnvironment.browserPath(options.env);
      browserFailed.resolve();
      throw new Error("browser install secret must not be logged");
    };

    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { HOME: paths.root, EXA_API_KEY: " " },
      run,
      warn: (message) => {
        warnings.push(message);
        if (message.includes("Hound browser setup failed")) browserWarning.resolve();
      },
    });
    expect(host.transformExecutions).toBe(0);
    expect(host.reloadCalls).toBe(0);
    expect(host.servers().size).toBe(0);
    host.applyTransforms();
    await uvStarted.promise;
    expect(host.transformExecutions).toBe(1);
    expect(host.servers().get("researcher-mcp")).toMatchObject({ command: [researcher] });
    expect(host.servers().has("exa")).toBe(false);
    expect(host.servers().has("hound")).toBe(false);
    expect(host.reloadCalls).toBe(0);

    finishUv.resolve();
    await browserFailed.promise;
    await browserWarning.promise;
    const hound = host.servers().get("hound")!;
    const python = (hound.command as string[])[0];
    const runtimeDirectory = python.slice(0, python.lastIndexOf(`${sep}env${sep}`));
    expect(relative(paths.cache, runtimeDirectory).startsWith("hound-")).toBe(true);
    expect(python).toEndWith(process.platform === "win32" ? join("env", "Scripts", "python.exe") : join("env", "bin", "python"));
    expect(hound).toMatchObject({
      type: "local",
      command: [python, "-m", "master_fetch"],
      cwd: paths.project,
      codemode: false,
      timeout: { startup: 120_000, catalog: 120_000, execution: 120_000 },
    });
    expect((hound.environment as Record<string, string>).PLAYWRIGHT_BROWSERS_PATH).toBe(join(runtimeDirectory, "browsers"));
    expect((hound.environment as Record<string, string>).HOME).toBe(join(runtimeDirectory, "home"));
    expect(host.reloadCalls).toBe(1);
    expect(host.transformExecutions).toBe(2);
    expect(calls).toEqual(["uv", "browser-query", "browser-install"]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).not.toContain("browser install secret");
    expect(warnings.join(" ")).toContain("Exa MCP is unavailable");
    expect(warnings.join(" ")).toContain("Hound browser setup failed");
    await cleanup?.();
  });

  it("does not await a pending MCP reload before browser setup or cleanup", async () => {
    const paths = fixture();
    addResearcherBinary(paths.dist);
    const pendingReload = deferred();
    const host = contextFixture(paths.project, { mcpCacheDirectory: paths.cache }, {}, false, () => pendingReload.promise);
    const browserInstallStarted = deferred();
    const browserInstallAborted = deferred();
    const runner = makeRunner();
    const run: ProcessRunner = async (command, args, options) => {
      if (command === "uv") return runner.run(command, args, options);
      if (args[0] === "-c") return runner.browserPath(options.env);
      browserInstallStarted.resolve();
      return new Promise<void>((_resolvePromise, rejectPromise) => {
        options.signal.addEventListener("abort", () => {
          browserInstallAborted.resolve();
          rejectPromise(new Error("aborted"));
        }, { once: true });
      });
    };
    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { HOME: paths.root, EXA_API_KEY: "test-key" },
      run,
      warn: () => {},
    });

    await browserInstallStarted.promise;
    expect(host.reloadCalls).toBe(1);
    expect(host.servers().has("hound")).toBe(true);
    const cleanupReturned = await Promise.race([
      Promise.resolve(cleanup?.()).then(() => true),
      new Promise<boolean>((resolvePromise) => setTimeout(() => resolvePromise(false), 100)),
    ]);
    expect(cleanupReturned).toBe(true);
    await browserInstallAborted.promise;
    pendingReload.resolve();
  });

  it("reuses only identity-matched cache markers and retries missing executables", async () => {
    const paths = fixture();
    const sourceManifest = readFileSync(join(paths.packageDirectory, "pyproject.toml"), "utf8");
    const sourceLock = readFileSync(join(paths.packageDirectory, "uv.lock"), "utf8");
    const events: string[] = [];
    const runner = makeRunner({ events });
    const prepared = await prepareHound(paths.packageDirectory, paths.cache, new AbortController().signal, {
      run: runner.run,
      env: { TEST_SETTING: "preserved" },
      onPythonReady: () => { events.push("ready"); },
    });

    expect(prepared.browserPath).toBe(runner.browserPath({ PLAYWRIGHT_BROWSERS_PATH: join(prepared.runtimeDirectory, "browsers") }));
    expect(events).toEqual(["uv", "ready", "browser-query", "browser-install"]);
    const sync = runner.calls[0];
    expect(sync.command).toBe("uv");
    expect(sync.args).toEqual(["sync", "--project", paths.packageDirectory, "--frozen", "--no-dev", "--no-editable", "--python", "3.12"]);
    expect(sync.cwd).toBe(paths.packageDirectory);
    expect(sync.env.UV_PROJECT_ENVIRONMENT).toBe(join(prepared.runtimeDirectory, "env"));
    expect(sync.env.UV_CACHE_DIR).toBe(join(prepared.runtimeDirectory, "uv"));
    expect(sync.env.UV_PYTHON_INSTALL_DIR).toBe(join(prepared.runtimeDirectory, "python"));
    expect(sync.env.HOME).toBe(join(prepared.runtimeDirectory, "home"));
    expect(sync.env.TEST_SETTING).toBe("preserved");
    expect(readFileSync(join(paths.packageDirectory, "pyproject.toml"), "utf8")).toBe(sourceManifest);
    expect(readFileSync(join(paths.packageDirectory, "uv.lock"), "utf8")).toBe(sourceLock);
    expect(() => readFileSync(join(paths.packageDirectory, ".venv"))).toThrow();

    const warm = await prepareHound(paths.packageDirectory, paths.cache, new AbortController().signal, runner.run);
    expect(warm.browserPath).toBe(prepared.browserPath);
    expect(runner.calls).toHaveLength(3);

    rmSync(prepared.pythonPath);
    await prepareHound(paths.packageDirectory, paths.cache, new AbortController().signal, { run: runner.run });
    expect(runner.calls.filter((call) => call.command === "uv")).toHaveLength(2);

    rmSync(prepared.browserPath!);
    await prepareHound(paths.packageDirectory, paths.cache, new AbortController().signal, { run: runner.run });
    expect(runner.calls.filter((call) => call.command === "uv")).toHaveLength(2);
    expect(runner.calls.filter((call) => call.args.includes("install"))).toHaveLength(2);

    writeFileSync(join(paths.packageDirectory, "uv.lock"), `${sourceLock}# changed lock\n`);
    const changedRuntime = await prepareHound(paths.packageDirectory, paths.cache, new AbortController().signal, { run: runner.run });
    expect(changedRuntime.runtimeDirectory).not.toBe(prepared.runtimeDirectory);
    expect(readFileSync(prepared.pythonPath, "utf8")).toBe("fake python");
    expect(runner.calls.filter((call) => call.command === "uv")).toHaveLength(3);
    expect(runner.calls.filter((call) => call.args.includes("install"))).toHaveLength(3);
  });

  it("recovers stale locks and serializes concurrent cache preparation", async () => {
    const stalePaths = fixture();
    const lockDirectory = join(runtimeDirectory(stalePaths.packageDirectory, stalePaths.cache), ".setup.lock");
    mkdirSync(lockDirectory, { recursive: true });
    writeFileSync(join(lockDirectory, "owner.json"), JSON.stringify({ pid: 2_147_483_647, token: "stale" }));
    const staleRunner = makeRunner();
    await prepareHound(stalePaths.packageDirectory, stalePaths.cache, new AbortController().signal, { run: staleRunner.run });
    expect(staleRunner.calls.filter((call) => call.command === "uv")).toHaveLength(1);

    const concurrentPaths = fixture();
    const started = deferred();
    const releaseSync = deferred();
    const runner = makeRunner();
    let syncCalls = 0;
    const concurrentRun: ProcessRunner = async (command, args, options) => {
      if (command === "uv") {
        syncCalls += 1;
        started.resolve();
        await releaseSync.promise;
      }
      return runner.run(command, args, options);
    };
    const first = prepareHound(concurrentPaths.packageDirectory, concurrentPaths.cache, new AbortController().signal, { run: concurrentRun });
    await started.promise;
    const second = prepareHound(concurrentPaths.packageDirectory, concurrentPaths.cache, new AbortController().signal, { run: concurrentRun });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    releaseSync.resolve();
    const results = await Promise.all([first, second]);
    expect(syncCalls).toBe(1);
    expect(results[0].pythonPath).toBe(results[1].pythonPath);
    expect(runner.calls.filter((call) => call.args.includes("install"))).toHaveLength(1);
  });

  it("aborts lock waits and prevents readiness or reload after plugin cleanup", async () => {
    const paths = fixture();
    const lockDirectory = join(runtimeDirectory(paths.packageDirectory, paths.cache), ".setup.lock");
    mkdirSync(lockDirectory, { recursive: true });
    writeFileSync(join(lockDirectory, "owner.json"), JSON.stringify({ pid: process.pid, token: "held" }));
    const controller = new AbortController();
    const waiting = prepareHound(paths.packageDirectory, paths.cache, controller.signal, { lockWaitMs: 1_000, lockPollMs: 5 });
    controller.abort();
    await expect(waiting).rejects.toThrow();

    const pluginPaths = fixture();
    const host = contextFixture(pluginPaths.project, {}, {
      "researcher-mcp": { type: "local", command: ["host-owned"] },
      exa: { type: "remote", url: "https://host-owned.invalid" },
    });
    const uvStarted = deferred();
    const stopped = deferred();
    const run: ProcessRunner = async (_command, _args, options) => {
      uvStarted.resolve();
      return new Promise<void>((_resolvePromise, rejectPromise) => {
        options.signal.addEventListener("abort", () => {
          stopped.resolve();
          rejectPromise(new Error("aborted"));
        }, { once: true });
      });
    };
    const warnings: string[] = [];
    const cleanup = await registerMcp(host.context, pluginPaths.dist, {
      env: { HOME: pluginPaths.root },
      run,
      warn: (message) => warnings.push(message),
    });
    await uvStarted.promise;
    await cleanup?.();
    await stopped.promise;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(host.reloadCalls).toBe(0);
    expect(host.servers().has("hound")).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("does not provision if the native transform first runs after unload", async () => {
    const paths = fixture();
    const host = contextFixture(paths.project, { mcpCacheDirectory: paths.cache }, {}, true);
    let processCalls = 0;
    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { HOME: paths.root },
      run: async () => { processCalls += 1; },
      warn: () => {},
    });

    await cleanup?.();
    host.applyTransforms();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(processCalls).toBe(0);
    expect(host.reloadCalls).toBe(0);
    expect(host.servers().has("hound")).toBe(false);
  });

  it("reports a missing uv executable without surfacing process details", async () => {
    const paths = fixture();
    const host = contextFixture(paths.project, { mcpCacheDirectory: paths.cache }, {
      "researcher-mcp": { type: "local", command: ["host-owned"] },
      exa: { type: "remote", url: "https://host-owned.invalid" },
    });
    const warning = deferred();
    const warnings: string[] = [];
    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { HOME: paths.root },
      run: async () => { throw Object.assign(new Error("sensitive spawn details"), { code: "ENOENT" }); },
      warn: (message) => {
        warnings.push(message);
        warning.resolve();
      },
    });
    await warning.promise;
    expect(warnings).toEqual(["[rice-opencode] Hound setup failed: uv was not found on PATH; install uv to enable Hound."]);
    expect(warnings.join(" ")).not.toContain("sensitive spawn details");
    await cleanup?.();
  });

  it("kills an active provisioning subprocess on cleanup", async () => {
    if (process.platform === "win32") return;
    const paths = fixture();
    const binaryDirectory = join(paths.root, "fake-bin");
    mkdirSync(binaryDirectory);
    const uv = join(binaryDirectory, "uv");
    writeFileSync(uv, "#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(process.env.TEST_UV_STARTED, String(process.pid));\nsetInterval(() => {}, 1000);\n");
    chmodSync(uv, 0o755);
    const host = contextFixture(paths.project, { mcpCacheDirectory: paths.cache }, {
      "researcher-mcp": { type: "local", command: ["host-owned"] },
      exa: { type: "remote", url: "https://host-owned.invalid" },
    });
    const cleanup = await registerMcp(host.context, paths.dist, {
      env: { PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`, HOME: paths.root, TEST_UV_STARTED: join(paths.root, "uv.started") },
      warn: () => {},
    });

    const startedFile = join(paths.root, "uv.started");
    for (let attempt = 0; attempt < 200 && !readFileSyncSafe(startedFile); attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    }
    const pid = Number(readFileSyncSafe(startedFile));
    expect(Number.isInteger(pid)).toBe(true);
    await cleanup?.();
    for (let attempt = 0; attempt < 200 && processAliveForTest(pid); attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    }
    expect(processAliveForTest(pid)).toBe(false);
    expect(host.reloadCalls).toBe(0);
  });
});

function readFileSyncSafe(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function processAliveForTest(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { Plugin } from "@opencode/plugin";
import { Host } from "@opencode/plugin/host";
import type { Info as NativeToolInfo, ToolContext as NativeToolContext } from "@opencode/plugin/promise/tool";

import V2Server, { VizPluginV2 } from "./server";
import NativeVizPlugin from "./v2";
import PackageEntry, { VizPluginV2 as PackagePlugin } from "../index";

type TestTool = {
  name: string;
  input: { parse(value: unknown): unknown };
  execute(input: unknown, context: NativeToolContext): Promise<{ content?: string; metadata?: Record<string, unknown> }>;
  options?: { permission?: string };
};

const roots: string[] = [];

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

function makePluginContext(directory: string, options: Record<string, unknown> = {}) {
  const tools = new Map<string, NativeToolInfo>();
  let sessionLookups = 0;
  const context = {
    options,
    session: {
      async get() {
        sessionLookups += 1;
        return { location: { directory } };
      },
    },
    tool: {
      async transform(callback: (editor: { add(tool: NativeToolInfo): void }) => void) {
        callback({ add: (tool) => tools.set(tool.name, tool) });
      },
    },
  } as unknown as Plugin.Context;

  return { context, tools, get sessionLookups() { return sessionLookups; } };
}

function toolFor(tools: Map<string, NativeToolInfo>): TestTool {
  return tools.get("viz_generate_image") as unknown as TestTool;
}

function nativeContext(signal = new AbortController().signal): NativeToolContext {
  return { sessionID: "session", signal, progress: async () => {} } as unknown as NativeToolContext;
}

async function execute(tool: TestTool, args: unknown, context: NativeToolContext) {
  return tool.execute(tool.input.parse(args), context);
}

describe("VizPluginV2", () => {
  it("registers only the image tool with edit action permission", async () => {
    const host = makePluginContext(tempDirectory("viz-v2-registration-"), { trustedWorkspaceWrites: true });
    await NativeVizPlugin.setup(host.context);

    expect([...host.tools.keys()]).toEqual(["viz_generate_image"]);
    expect(toolFor(host.tools).options?.permission).toBe("edit");
  });

  it("requires explicit trusted writes before image execution", async () => {
    const root = tempDirectory("viz-v2-trust-");

    for (const options of [{}, { trustedWorkspaceWrites: false }]) {
      const host = makePluginContext(root, options);
      await NativeVizPlugin.setup(host.context);
      await expect(execute(toolFor(host.tools), {
        prompt: "cat",
        output_path: "image.png",
      }, nativeContext())).rejects.toThrow("trustedWorkspaceWrites: true");
      expect(host.sessionLookups).toBe(0);
    }
  });

  it("delegates execution with cancellation and makes no provider request", async () => {
    const root = tempDirectory("viz-v2-cancel-");
    const host = makePluginContext(root, { trustedWorkspaceWrites: true });
    await NativeVizPlugin.setup(host.context);
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(execute(toolFor(host.tools), {
      prompt: "cat",
      output_path: "cancelled.png",
    }, nativeContext(controller.signal))).rejects.toMatchObject({ name: "AbortError", message: "cancelled" });
    expect(host.sessionLookups).toBe(0);
    expect(() => readFileSync(join(root, "cancelled.png"))).toThrow();
  });

  it("rejects symlinked output targets without changing the external file", async () => {
    const root = tempDirectory("viz-v2-output-root-");
    const outside = tempDirectory("viz-v2-output-outside-");
    const outsideFile = join(outside, "outside.png");
    writeFileSync(outsideFile, "unchanged");
    symlinkSync(outsideFile, join(root, "linked.png"));
    const host = makePluginContext(root, { trustedWorkspaceWrites: true });
    await NativeVizPlugin.setup(host.context);

    await expect(execute(toolFor(host.tools), {
      prompt: "cat",
      output_path: "linked.png",
      overwrite: true,
    }, nativeContext())).rejects.toThrow("symbolic link");
    expect(readFileSync(outsideFile, "utf8")).toBe("unchanged");
  });

  it("forwards native-only plugin entrypoints and resolves the local server entrypoint", async () => {
    const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

    expect(V2Server).toBe(VizPluginV2);
    expect("server" in V2Server).toBe(false);
    expect(PackageEntry).toBe(VizPluginV2);
    expect(PackagePlugin).toBe(VizPluginV2);
    expect(V2Server.setup).toBe(VizPluginV2.setup);
    expect(fileURLToPath(Host.resolve({ directory: packageDirectory }).server!)).toBe(join(packageDirectory, "server.ts"));
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Plugin } from "@opencode/plugin";
import type { Info as NativeToolInfo, ToolContext as NativeToolContext } from "@opencode/plugin/promise/tool";

import { tool } from "../../../src/custom-tools/tool";
import { createWorkspaceTool } from "./v2-tool";

const roots: string[] = [];

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

function makePluginContext(
  sessions: Record<string, { directory: string; subpath?: string }>,
  options: Record<string, unknown> = {},
): Plugin.Context {
  return {
    options,
    session: {
      async get({ sessionID }: { sessionID: string }) {
        const session = sessions[sessionID];
        if (!session) throw new Error(`Unknown session: ${sessionID}`);
        return { location: { directory: session.directory }, subpath: session.subpath };
      },
    },
  } as unknown as Plugin.Context;
}

function nativeContext(sessionID: string, signal = new AbortController().signal): NativeToolContext {
  return {
    sessionID: sessionID as NativeToolContext["sessionID"],
    agent: "test-agent" as NativeToolContext["agent"],
    messageID: "test-message" as NativeToolContext["messageID"],
    id: "test-call" as NativeToolContext["id"],
    signal,
    progress: async () => {},
  };
}

function invoke(tool: NativeToolInfo, args: unknown, sessionID: string, signal?: AbortSignal): Promise<unknown> {
  return tool.execute(args, nativeContext(sessionID, signal));
}

describe("createWorkspaceTool", () => {
  it("derives each invocation worktree and nested directory from the calling session", async () => {
    const first = tempDirectory("v2-session-one-");
    const second = tempDirectory("v2-session-two-");
    const nested = join(second, "packages", "app");
    mkdirSync(nested, { recursive: true });
    const probe = tool({
      description: "Return invocation context",
      args: {},
      async execute(_args, context) {
        context.metadata({ title: "Invocation", metadata: { worktree: context.worktree, directory: context.directory } });
        return "ok";
      },
    });
    const adapted = createWorkspaceTool("probe", probe, makePluginContext({
      first: { directory: first },
      second: { directory: second, subpath: "packages/app" },
    }));

    const firstResult = await invoke(adapted, {}, "first") as { content: string; metadata: Record<string, unknown> };
    const secondResult = await invoke(adapted, {}, "second") as { content: string; metadata: Record<string, unknown> };

    expect(firstResult).toEqual({
      content: "ok",
      metadata: { worktree: first, directory: first, title: "Invocation" },
    });
    expect(secondResult).toEqual({
      content: "ok",
      metadata: { worktree: second, directory: nested, title: "Invocation" },
    });
  });

  it("rejects external workspace overrides and symlinked session roots before tool execution", async () => {
    const root = tempDirectory("v2-safe-root-");
    const outside = tempDirectory("v2-safe-outside-");
    const rootLink = `${root}-link`;
    const workspaceLink = join(root, "outside-link");
    roots.push(rootLink);
    symlinkSync(root, rootLink, "dir");
    symlinkSync(outside, workspaceLink, "dir");

    let calls = 0;
    const probe = tool({
      description: "Count calls",
      args: { workspaceRoot: tool.schema.string().optional() },
      async execute() {
        calls += 1;
        return "called";
      },
    });
    const adapted = createWorkspaceTool("probe", probe, makePluginContext({
      normal: { directory: root },
      linked: { directory: rootLink },
    }));

    await expect(invoke(adapted, { workspaceRoot: outside }, "normal")).rejects.toThrow("workspaceRoot must stay inside");
    await expect(invoke(adapted, { workspaceRoot: "outside-link" }, "normal")).rejects.toThrow("must not be a symlink");
    await expect(invoke(adapted, {}, "linked")).rejects.toThrow("must not be a symbolic link");
    expect(calls).toBe(0);
  });

  it("requires trusted writes and validates requested mutation paths", async () => {
    const root = tempDirectory("v2-trusted-root-");
    const outside = tempDirectory("v2-trusted-outside-");
    let calls = 0;
    const probe = tool({
      description: "Request a mutation",
      args: {},
      async execute(_args, context) {
        calls += 1;
        await context.ask({ permission: "edit", patterns: [outside], always: [outside], metadata: {} });
        return "mutated";
      },
    });
    const sessions = { session: { directory: root } };

    const untrusted = createWorkspaceTool("probe", probe, makePluginContext(sessions), true);
    await expect(invoke(untrusted, {}, "session")).rejects.toThrow("trustedWorkspaceWrites: true");
    expect(calls).toBe(0);

    const trusted = createWorkspaceTool("probe", probe, makePluginContext(sessions, { trustedWorkspaceWrites: true }), true);
    await expect(invoke(trusted, {}, "session")).rejects.toThrow("target must stay inside the calling session worktree");
    expect(calls).toBe(1);
  });

  it("uses the definition schema and converts structured output and metadata", async () => {
    const root = tempDirectory("v2-schema-result-");
    const probe = tool({
      description: "Return a defaulted structured result",
      args: { value: tool.schema.string().default("default") },
      async execute(args, context) {
        context.metadata({ title: "Probe", metadata: { fromContext: true } });
        return { output: args.value, metadata: { fromResult: true } };
      },
    });
    const adapted = createWorkspaceTool("probe", probe, makePluginContext({ session: { directory: root } }));

    expect(adapted.input).toBe(probe.schema);
    expect(await invoke(adapted, {}, "session")).toEqual({
      content: "default",
      metadata: { fromContext: true, fromResult: true, title: "Probe" },
    });
    await expect(invoke(adapted, { value: 1 }, "session")).rejects.toThrow();
  });

  it("maps string output and preserves the abort signal", async () => {
    const root = tempDirectory("v2-abort-map-");
    let receivedSignal: AbortSignal | undefined;
    const probe = tool({
      description: "Return abort state",
      args: {},
      async execute(_args, context) {
        receivedSignal = context.abort;
        return "plain output";
      },
    });
    const adapted = createWorkspaceTool("probe", probe, makePluginContext({ session: { directory: root } }));
    const controller = new AbortController();
    const result = await invoke(adapted, {}, "session", controller.signal);

    expect(receivedSignal).toBe(controller.signal);
    expect(result).toEqual({ content: "plain output" });

    receivedSignal = undefined;
    controller.abort(new Error("cancelled"));
    await expect(invoke(adapted, {}, "session", controller.signal)).rejects.toThrow("cancelled");
    expect(receivedSignal).toBeUndefined();
  });
});

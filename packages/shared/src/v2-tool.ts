import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import type { Plugin as NativePlugin } from "@opencode/plugin";
import type { Info as NativeToolInfo } from "@opencode/plugin/promise/tool";
import type { ZodRawShape } from "zod";

import type { ToolContext, ToolDefinition } from "../../../src/custom-tools/tool";
import { assertSafePathAccess, isWithinWorkspaceRoot, resolveWorkspaceRoot } from "../../../src/custom-tools/workplan/shared";

type NativePluginContext = NativePlugin.Context;

/** Adapts a workspace tool to the native Promise plugin API. */
export function createWorkspaceTool<Shape extends ZodRawShape>(
  name: string,
  definition: ToolDefinition<Shape>,
  pluginContext: NativePluginContext,
  mutates = false,
): NativeToolInfo {
  return {
    name,
    description: definition.description,
    input: definition.schema,
    options: { codemode: false, ...(mutates ? { permission: "edit" } : {}) },
    async execute(args, nativeContext) {
      nativeContext.signal.throwIfAborted();
      if (mutates && pluginContext.options.trustedWorkspaceWrites !== true) {
        throw new Error(`${name} requires trustedWorkspaceWrites: true.`);
      }

      const parsed = definition.schema.parse(args);
      const session = await pluginContext.session.get({ sessionID: nativeContext.sessionID });
      const worktree = resolve(session.location.directory);
      const rootStat = await lstat(worktree);
      if (rootStat.isSymbolicLink()) throw new Error("Calling session worktree must not be a symbolic link.");
      if (!rootStat.isDirectory()) throw new Error("Calling session worktree must be a directory.");

      const directory = resolve(worktree, session.subpath || ".");
      if (!isWithinWorkspaceRoot(worktree, directory)) {
        throw new Error("Calling session directory must stay inside its worktree.");
      }
      await assertSafePathAccess(worktree, directory, "Calling session directory");

      const workspaceRootOverride = "workspaceRoot" in parsed && typeof parsed.workspaceRoot === "string"
        ? parsed.workspaceRoot
        : undefined;
      const workspaceRoot = resolveWorkspaceRoot(worktree, workspaceRootOverride);
      if (!isWithinWorkspaceRoot(worktree, workspaceRoot)) {
        throw new Error("workspaceRoot must stay inside the calling session worktree.");
      }
      await assertSafePathAccess(worktree, workspaceRoot, "workspaceRoot");

      let title: string | undefined;
      let metadata: Record<string, unknown> | undefined;
      const context: ToolContext = {
        worktree,
        directory,
        sessionID: nativeContext.sessionID,
        messageID: nativeContext.messageID,
        agent: nativeContext.agent,
        abort: nativeContext.signal,
        metadata(value: { title?: string; metadata?: Record<string, unknown> }) {
          title = value.title ?? title;
          metadata = { ...metadata, ...value.metadata };
        },
        ask: async (permission) => {
          nativeContext.signal.throwIfAborted();
          // V2 has no blocking permission prompt: edit is action-level only.
          // Mutations instead require the explicit trusted-workspace option and
          // every requested patch path is validated below before any write.
          if (permission.permission === "external_directory") {
            throw new Error("External workspace access is not allowed by the V2 trusted-write policy.");
          }
          if (permission.permission !== "edit") {
            throw new Error(`Unsupported ${name} permission: ${permission.permission}`);
          }
          if (!mutates || pluginContext.options.trustedWorkspaceWrites !== true) {
            throw new Error(`${name} requires trustedWorkspaceWrites: true.`);
          }
          if (!permission.patterns.length) throw new Error(`${name} requires a target path.`);

          for (const pattern of permission.patterns) {
            const target = resolve(worktree, pattern);
            if (!isWithinWorkspaceRoot(worktree, target)) {
              throw new Error(`${name} target must stay inside the calling session worktree.`);
            }
            await assertSafePathAccess(worktree, target, "Patch target");
          }
        },
      };

      nativeContext.signal.throwIfAborted();
      const result = await definition.execute(parsed, context);
      const resultOutput = typeof result === "string" ? result : result.output;
      const resultMetadata = typeof result === "string" ? undefined : result.metadata;
      const combinedMetadata = {
        ...metadata,
        ...resultMetadata,
        ...(title ? { title } : {}),
      };

      return {
        content: resultOutput,
        ...(Object.keys(combinedMetadata).length ? { metadata: combinedMetadata } : {}),
      };
    },
  };
}

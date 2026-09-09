/**
 * token-saver — V2-only OpenCode plugin.
 *
 * Phase 1 (meter): counts per-tool calls plus chars/4 token estimates via
 * the `execute.after` tool hook, exposed through `token_saver_status`.
 * Slimmer/pruner patterns are gated behind options and land in later phases.
 *
 * Every hook fails open: on unexpected shapes it records nothing and never
 * breaks dispatch. Only sizes are stored — never prompt content or results.
 */

import { Plugin } from "@opencode-ai/plugin";
import { MeterStore } from "./meter";
import { sizableText, validateOptions, type TokenSaverOptions } from "./policy";
import { compactResultText, shortenDescription } from "./slim";

export const PLUGIN_ID = "token-saver";

export interface TokenSaverState {
  options: TokenSaverOptions;
  meter: MeterStore;
}

export function createTokenSaverState(rawOptions?: unknown): TokenSaverState {
  return { options: validateOptions(rawOptions), meter: new MeterStore() };
}

/** Minimal structural view of the V2 execute.after tool event we read. */
interface AfterEvent {
  readonly tool?: unknown;
  readonly sessionID?: unknown;
  readonly status?: unknown;
  readonly input?: unknown;
  readonly result?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function getStatus(state: TokenSaverState, sessionID?: string, top?: number): string {
  const snapshot = state.meter.snapshot(sessionID);
  const limit = top === undefined ? snapshot.byTool.length : Math.max(0, Math.min(top, snapshot.byTool.length));
  const lines = snapshot.byTool.slice(0, limit).map(
    (t) => `${t.tool}: ${t.calls} calls (${t.errors} errors), ~${t.inputTokens} in / ~${t.outputTokens} out tokens`,
  );
  return JSON.stringify(
    {
      plugin: PLUGIN_ID,
      sessions: snapshot.sessions,
      calls: snapshot.calls,
      inputTokens: snapshot.inputTokens,
      outputTokens: snapshot.outputTokens,
      estimate: "chars/4 heuristic",
      byTool: lines,
    },
    null,
    2,
  );
}

const STATUS_TOOL_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    sessionID: {
      type: "string",
      description: "Filter accounting to one session ID (omit for all sessions).",
    },
    limit: {
      type: "number",
      description: "Max tool rows to return (default 20).",
    },
  },
} as const;

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const state = createTokenSaverState(ctx.options);

    if (state.options.patterns.meter) {
      await ctx.tool.hook("execute.after", async (event) => {
        try {
          const e = (event ?? {}) as AfterEvent;
          if (typeof e.tool !== "string" || typeof e.sessionID !== "string") return;
          const inputChars = sizableText(e.input).length;
          const status = asRecord(e) as (Record<string, unknown> & { status?: unknown; result?: unknown }) | null;
          const error = e.status === "error";
          const rawResult = error ? undefined : status?.result;
          let resultText = typeof rawResult === "string" ? rawResult : sizableText(rawResult);
          if (!error && typeof rawResult === "string" && state.options.patterns.slimmer && resultText.length > state.options.maxResultChars) {
            const compacted = compactResultText(resultText, state.options.maxResultChars);
            if (compacted.truncated && status && typeof status === "object") {
              (status as Record<string, unknown>).result = compacted.text;
            }
            resultText = compacted.text;
          }
          state.meter.record(e.sessionID, e.tool, inputChars, resultText.length, error);
        } catch (error) {
          console.warn(`[token-saver] meter skipped: ${String(error)}`);
        }
      });
    }

    if (state.options.patterns.slimmer) {
      await ctx.tool.transform((editor) => {
        try {
          for (const tool of editor.list()) {
            if (typeof tool.description !== "string") continue;
            const short = shortenDescription(tool.description);
            if (short !== null) {
              editor.update(tool.id, (t) => {
                (t as { description: string }).description = short;
              });
            }
          }
        } catch (error) {
          console.warn(`[token-saver] slimmer skipped: ${String(error)}`);
        }
      });
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "token_saver_status",
        description:
          "Show per-tool call counts and estimated token usage for this session or all sessions. Sizes only; no prompt content is stored.",
        input: STATUS_TOOL_INPUT,
        execute: async (input) => {
          const args = asRecord(input) ?? {};
          const sessionID = typeof args.sessionID === "string" ? args.sessionID : undefined;
          const limit =
            typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
              ? Math.min(Math.floor(args.limit), 100)
              : 20;
          return { content: getStatus(state, sessionID, limit) };
        },
      });
    });
  },
});

/**
 * quota-fallback — V2-only OpenCode plugin.
 *
 * A session `retry` hook watches provider failures. On quota/rate-limit
 * errors it switches the session to a configured fallback model (ordered
 * preferences, optional per-agent scoping) and schedules the retry on the
 * fresh model. A per-session circuit breaker stops failover loops; any other
 * error type is left to OpenCode's native retry policy untouched.
 *
 * There is deliberately no switch-back: the session stays on the fallback
 * until the operator switches it back or the session ends.
 */

import { Plugin } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import {
  extractAgentFallbackModel,
  isQuotaError,
  modelKey,
  parseModelRef,
  selectFallback,
  validateQuotaOptions,
  type ModelRef,
  type QuotaOptions,
} from "./policy";

export const PLUGIN_ID = "quota-fallback";

/** Minimal structural view of the V2 session-retry event we mutate. */
export interface RetryEvent {
  readonly sessionID: string;
  readonly agent: string;
  readonly model: {
    readonly providerID?: string;
    readonly id?: string;
    readonly variant?: string;
  };
  readonly error: {
    readonly type: string;
    readonly message: string;
    readonly status?: number;
  };
  readonly attempt: number;
  decision: { retry: boolean; delay?: number };
}

export interface FallbackRecord {
  sessionID: string;
  agent: string;
  from: string;
  to: string;
  /** Where the fallback came from: the agent file or the shared chain. */
  source: "agent" | "options";
  errorType: string;
  status?: number;
  attempt: number;
  at: string;
}

interface SessionTrack {
  /** Model keys that already failed quota here; never select them again. */
  failed: Set<string>;
  switches: number;
}

export interface QuotaState {
  options: QuotaOptions;
  sessions: Map<string, SessionTrack>;
  diagnostics: FallbackRecord[];
}

export function createQuotaState(rawOptions?: unknown): QuotaState {
  return {
    options: validateQuotaOptions(rawOptions),
    sessions: new Map(),
    diagnostics: [],
  };
}

function trackFor(state: QuotaState, sessionID: string): SessionTrack {
  let track = state.sessions.get(sessionID);
  if (!track) {
    track = { failed: new Set(), switches: 0 };
    state.sessions.set(sessionID, track);
  }
  return track;
}

/**
 * Reads raw agent-file text for a per-agent `# fallback-model:` directive.
 * Resolution is best-effort and local-only; unresolvable agents fall back to
 * the shared chain.
 */
export interface AgentFileReader {
  readAgentFile(agentID: string): Promise<string | undefined>;
}

/**
 * File reader over `agents/<id>.md` under the given root directories, first
 * hit wins. The agent ID is strictly validated to prevent path traversal.
 */
export function fileAgentReader(roots: string[]): AgentFileReader {
  const unique = [...new Set(roots.filter((root) => typeof root === "string" && root.length > 0))];
  return {
    readAgentFile: async (agentID: string) => {
      if (!/^[\w-]+$/.test(agentID)) return undefined;
      for (const root of unique) {
        try {
          return await readFile(`${root}/agents/${agentID}.md`, "utf-8");
        } catch {
          // Try the next root.
        }
      }
      return undefined;
    },
  };
}

/**
 * Resolve the next fallback model: the agent file's `# fallback-model:`
 * directive first (agent-local declaration wins), then the shared
 * plugin-option chain. Invalid or excluded directives warn and fall through.
 */
export async function resolveNextModel(
  state: QuotaState,
  agent: string,
  exclude: ReadonlySet<string>,
  readAgentFile?: AgentFileReader["readAgentFile"],
): Promise<{ model: ModelRef; source: "agent" | "options" } | undefined> {
  if (readAgentFile) {
    try {
      const text = await readAgentFile(agent);
      const raw = text ? extractAgentFallbackModel(text) : undefined;
      if (raw) {
        try {
          const model = parseModelRef(raw);
          if (!exclude.has(modelKey(model))) return { model, source: "agent" };
        } catch (error) {
          console.warn(
            `[quota-fallback] agent '${agent}' has an invalid fallback-model directive, using shared chain: ${String(error)}`,
          );
        }
      }
    } catch (error) {
      console.warn(
        `[quota-fallback] could not read agent file for '${agent}', using shared chain: ${String(error)}`,
      );
    }
  }
  const model = selectFallback(state.options, agent, exclude);
  return model ? { model, source: "options" } : undefined;
}

function recordDiagnostic(state: QuotaState, record: FallbackRecord): void {
  state.diagnostics.push(record);
  while (state.diagnostics.length > 100) state.diagnostics.shift();
}

/**
 * Handle one retry event. Switches the model and forces a delayed retry only
 * on quota errors with a remaining circuit-breaker budget and an applicable
 * fallback. Never throws; any failure leaves the native decision untouched.
 */
export async function handleRetry(
  state: QuotaState,
  event: RetryEvent,
  switchModel: (model: ModelRef) => Promise<void>,
  readAgentFile?: AgentFileReader["readAgentFile"],
): Promise<void> {
  try {
    if (!state.options.enabled) return;
    if (!isQuotaError(event.error)) return;

    const track = trackFor(state, event.sessionID);
    track.failed.add(modelKey(event.model));
    if (track.switches >= state.options.maxSwitchesPerSession) return;

    const next = await resolveNextModel(state, event.agent, track.failed, readAgentFile);
    if (!next) return;

    try {
      await switchModel(next.model);
    } catch (error) {
      console.warn(
        `[quota-fallback] session=${event.sessionID} switch to ${modelKey(next.model)} failed, keeping native decision: ${String(error)}`,
      );
      return;
    }
    track.switches++;
    track.failed.add(modelKey(next.model));

    event.decision = { retry: true, delay: state.options.retryDelayMs };

    const record: FallbackRecord = {
      sessionID: event.sessionID,
      agent: event.agent,
      from: modelKey(event.model),
      to: modelKey(next.model),
      source: next.source,
      errorType: event.error.type,
      ...(typeof event.error.status === "number" ? { status: event.error.status } : {}),
      attempt: event.attempt,
      at: new Date().toISOString(),
    };
    recordDiagnostic(state, record);
    console.info(
      `[quota-fallback] session=${event.sessionID} agent=${event.agent} ` +
        `quota (${event.error.type}${typeof event.error.status === "number" ? `/${event.error.status}` : ""}) ` +
        `at attempt ${event.attempt}: ${record.from} -> ${record.to} via ${next.source}, retry in ${state.options.retryDelayMs}ms`,
    );
  } catch (error) {
    console.warn(`[quota-fallback] failover skipped: ${String(error)}`);
  }
}

export function getFallbackDiagnostics(
  state: QuotaState,
  sessionID?: string,
): FallbackRecord[] {
  const entries = sessionID
    ? state.diagnostics.filter((record) => record.sessionID === sessionID)
    : state.diagnostics;
  return entries.map((record) => ({ ...record }));
}

const STATUS_TOOL_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    sessionID: {
      type: "string",
      description: "Filter diagnostics to one session ID (omit for recent entries).",
    },
    limit: {
      type: "number",
      description: "Max entries to return (default 20, up to 100).",
    },
  },
} as const;

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const state = createQuotaState(ctx.options);
    const location = ctx.location as unknown as {
      directory?: unknown;
      project?: { directory?: unknown };
    };
    const roots = [
      typeof location?.project?.directory === "string" ? location.project.directory : undefined,
      typeof location?.directory === "string" ? location.directory : undefined,
    ].filter((root): root is string => typeof root === "string" && root.length > 0);
    const reader = fileAgentReader(roots);

    await ctx.session.hook("retry", async (event) => {
      const retryEvent = event as unknown as RetryEvent;
      await handleRetry(
        state,
        retryEvent,
        (model) => ctx.session.switchModel({ sessionID: retryEvent.sessionID, model }),
        (agent) => reader.readAgentFile(agent),
      );
    });

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "quota_fallback_status",
        description:
          "Show recent quota-fallback model switches (session, agent, from/to models, error, attempt). No prompt content is stored.",
        input: STATUS_TOOL_INPUT,
        execute: async (input) => {
          const args =
            input && typeof input === "object"
              ? (input as { sessionID?: unknown; limit?: unknown })
              : {};
          const sessionID =
            typeof args.sessionID === "string" ? args.sessionID : undefined;
          const limit =
            typeof args.limit === "number" &&
            Number.isFinite(args.limit) &&
            args.limit > 0
              ? Math.min(Math.floor(args.limit), 100)
              : 20;
          const entries = getFallbackDiagnostics(state, sessionID).slice(-limit);
          return {
            content: JSON.stringify(
              {
                plugin: PLUGIN_ID,
                enabled: state.options.enabled,
                count: entries.length,
                entries,
              },
              null,
              2,
            ),
          };
        },
      });
    });
  },
});

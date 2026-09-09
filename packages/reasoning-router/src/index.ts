/**
 * reasoning-router — V2-only OpenCode plugin.
 *
 * A session `context` hook scoped to the OpenAI provider sets
 * `providerOptions.reasoningEffort` immediately before each model call.
 * Parents request a bounded semantic class (`auto`/`fast`/`balanced`/`deep`)
 * via a validated prompt marker; deterministic policy controls the effort.
 *
 * Marker syntax (first match in the child task wins):
 *   [reasoning:fast] [reasoning:balanced] [reasoning:deep] [reasoning:auto]
 *   Append `:escalate` (or `+escalate`) for one-level escalation, e.g.
 *   `[reasoning:deep:escalate]`.
 */

import { Plugin } from "@opencode-ai/plugin";
import {
  collectMessageText,
  IGNORED_AGENTS,
  isReasoningClass,
  parseReasoningMarker,
  providerRuleFor,
  resolveReasoningEffort,
  stripReasoningMarkers,
  validateOptions,
  type ReasoningClass,
  type ReasoningEffort,
  type RouterOptions,
} from "./policy";

export const PLUGIN_ID = "reasoning-router";

/** Minimal structural view of the V2 session-context event we mutate. */
export interface ContextEvent {
  readonly sessionID: string;
  readonly agent: string;
  readonly model: {
    readonly providerID?: string;
    readonly id?: string;
    readonly variant?: string;
  };
  messages: unknown;
  providerOptions: Record<string, unknown>;
}

export interface RoutingRecord {
  sessionID: string;
  agent: string;
  model: string;
  provider: string;
  requested: ReasoningClass;
  escalate: boolean;
  /** `null` when no override was applied (fallback). */
  resolved: ReasoningEffort | null;
  /** providerOptions key that received the effort. */
  option: string;
  rule: string;
  fallback?: string;
  at: string;
}

export interface SessionRouting {
  effort: ReasoningEffort | undefined;
  agent: string;
  record: RoutingRecord;
}

export interface RouterState {
  options: RouterOptions;
  /** Resolved effort per child session; `undefined` effort = deliberate no-op. */
  sessions: Map<string, SessionRouting>;
  /** sessionID -> is-child (has parentID). Root sessions are never routed. */
  parents: Map<string, boolean>;
  diagnostics: RoutingRecord[];
}

export function createRouterState(rawOptions?: unknown): RouterState {
  return {
    options: validateOptions(rawOptions),
    sessions: new Map(),
    parents: new Map(),
    diagnostics: [],
  };
}

function modelLabel(event: ContextEvent): string {
  const provider = event.model?.providerID ?? "?";
  const id = event.model?.id ?? "?";
  const variant = event.model?.variant ? `#${event.model.variant}` : "";
  return `${provider}/${id}${variant}`;
}

function recordDiagnostic(state: RouterState, record: RoutingRecord): void {
  state.diagnostics.push(record);
  while (state.diagnostics.length > state.options.diagnosticsLimit) {
    state.diagnostics.shift();
  }
}

/**
 * Apply routing to one model-context event fired under `providerID` scope.
 * Mutates only `event.messages` (marker stripping) and `event.providerOptions`.
 * Never throws: on unexpected shapes it leaves the event untouched.
 *
 * Markers are stripped on every routed call because context mutations apply
 * to the outgoing call only — persisted history still carries the marker, so
 * continuations would otherwise resurface it. Stripping every call also keeps
 * re-resolution working after an agent switch.
 */
export function handleModelContext(
  state: RouterState,
  event: ContextEvent,
  providerID: string,
): void {
  try {
    const rule = providerRuleFor(state.options, providerID);
    if (!rule) return;

    const agent = event.agent;
    if (!agent || IGNORED_AGENTS.has(agent)) return;
    if (!state.options.agentPolicy[agent]) return;

    const modelProvider = event.model?.providerID;
    if (modelProvider && modelProvider !== providerID) return;

    // Collect before stripping: context mutations apply to the outgoing
    // call only, so the marker must be read first, then removed every call.
    const text = collectMessageText(event.messages);
    const marker = text ? parseReasoningMarker(text) : undefined;
    stripReasoningMarkers(event.messages);

    const existing = state.sessions.get(event.sessionID);
    if (existing && existing.agent === agent) {
      if (existing.effort !== undefined) {
        event.providerOptions[rule.option] = existing.effort;
      }
      return;
    }
    const switchedFrom = existing && existing.agent !== agent ? existing.agent : undefined;
    if (existing) state.sessions.delete(event.sessionID);

    const requested: ReasoningClass = marker?.requested ?? "auto";
    const escalate = marker?.escalate ?? false;
    if (!isReasoningClass(requested)) return;

    const resolution = resolveReasoningEffort({
      agent,
      requested,
      escalate,
      supported: rule.efforts,
      policy: state.options.agentPolicy,
      classBase: state.options.classBase,
    });

    if (resolution.effort !== undefined) {
      event.providerOptions[rule.option] = resolution.effort;
    }

    const ruleText = switchedFrom
      ? `${resolution.rule} (session switched agent ${switchedFrom} -> ${agent}; re-resolved)`
      : resolution.rule;
    const record: RoutingRecord = {
      sessionID: event.sessionID,
      agent,
      model: modelLabel(event),
      provider: providerID,
      requested: resolution.requested,
      escalate,
      resolved: resolution.effort ?? null,
      option: rule.option,
      rule: ruleText,
      ...(resolution.fallback ? { fallback: resolution.fallback } : {}),
      at: new Date().toISOString(),
    };
    state.sessions.set(event.sessionID, { effort: resolution.effort, agent, record });
    recordDiagnostic(state, record);
    console.info(
      `[reasoning-router] session=${event.sessionID} agent=${agent} ` +
        `provider=${providerID} requested=${requested}${escalate ? "+escalate" : ""} ` +
        `resolved=${resolution.effort ?? "(model default)"} rule="${ruleText}"` +
        (resolution.fallback ? ` fallback="${resolution.fallback}"` : ""),
    );
  } catch (error) {
    // Fall back to the agent's configured model variant: never break dispatch.
    console.warn(`[reasoning-router] routing skipped: ${String(error)}`);
  }
}

export function getDiagnostics(
  state: RouterState,
  sessionID?: string,
): RoutingRecord[] {
  const entries = sessionID
    ? state.diagnostics.filter((record) => record.sessionID === sessionID)
    : state.diagnostics;
  return entries.map((record) => ({ ...record }));
}

/** Minimal session reader for root/child discrimination. */
export interface SessionReader {
  getInfo(sessionID: string): Promise<{ parentID?: unknown }>;
}

/**
 * True when the session is a delegated child (has a parentID). Results are
 * cached per session. Lookup failures fail open (route as child) so a
 * transient metadata outage degrades to the pre-scoping behavior instead of
 * silently disabling routing; failures are logged, never cached.
 */
export async function isChildSession(
  reader: SessionReader,
  state: RouterState,
  sessionID: string,
): Promise<boolean> {
  const cached = state.parents.get(sessionID);
  if (cached !== undefined) return cached;
  try {
    const info = await reader.getInfo(sessionID);
    const isChild =
      typeof info?.parentID === "string" && info.parentID.length > 0;
    state.parents.set(sessionID, isChild);
    return isChild;
  } catch (error) {
    console.warn(
      `[reasoning-router] session lookup failed for ${sessionID}, routing as child: ${String(error)}`,
    );
    return true;
  }
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
      description: "Max entries to return (default 20, up to diagnosticsLimit).",
    },
  },
} as const;

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const state = createRouterState(ctx.options);
    const reader: SessionReader = {
      getInfo: async (sessionID: string) => {
        const info = await ctx.session.get({ sessionID });
        const parentID = (info as unknown as { parentID?: unknown })?.parentID;
        return { parentID };
      },
    };

    // One hook registration per configured provider: unlisted providers
    // never reach the handler and keep their model behavior.
    for (const pid of Object.keys(state.options.providers)) {
      await ctx.session.hook(
        "context",
        async (event) => {
          const contextEvent = event as unknown as ContextEvent;
          // Root sessions (no parentID) keep their configured model variant.
          if (!(await isChildSession(reader, state, contextEvent.sessionID))) return;
          handleModelContext(state, contextEvent, pid);
        },
        { providerID: pid },
      );
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "reasoning_router_status",
        description:
          "Show recent reasoning-router decisions (session, agent, requested class, resolved effort, matched rule). No prompt content is stored.",
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
              ? Math.min(Math.floor(args.limit), state.options.diagnosticsLimit)
              : 20;
          const entries = getDiagnostics(state, sessionID).slice(-limit);
          return {
            content: JSON.stringify(
              {
                plugin: PLUGIN_ID,
                providers: Object.keys(state.options.providers),
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

import { describe, expect, it } from "bun:test";
import {
  createQuotaState,
  getFallbackDiagnostics,
  handleRetry,
  resolveNextModel,
  type QuotaState,
  type RetryEvent,
} from "./index";
import type { ModelRef } from "./policy";

const OPENAI = { providerID: "openai", id: "gpt-5.6-luna" };
const FREE = { providerID: "opencode", id: "muse-spark-1.3-contributor-free" };

function quotaEvent(overrides: Partial<RetryEvent> = {}): RetryEvent {
  return {
    sessionID: "ses_a",
    agent: "explore",
    model: { ...OPENAI },
    error: { type: "provider.rate-limited", message: "slow down", status: 429 },
    attempt: 1,
    decision: { retry: false },
    ...overrides,
  };
}

function freshState(): QuotaState {
  return createQuotaState({ fallbacks: [{ model: { ...FREE } }] });
}

describe("agent-file preference", () => {
  const agentFile = (directive: string): string =>
    `---\ndescription: x\nmode: subagent\nmodel: openai/gpt-x\n${directive}\n---\n\nPrompt.`;
  const readerFor = (text: string | undefined) => async () => text;

  it("prefers the agent directive over the shared chain", async () => {
    const state = freshState();
    const switched: ModelRef[] = [];
    const event = quotaEvent();
    await handleRetry(
      state,
      event,
      async (model) => {
        switched.push(model);
      },
      readerFor(agentFile("# fallback-model: other/special-model")),
    );
    expect(switched).toEqual([{ providerID: "other", id: "special-model" }]);
    expect(getFallbackDiagnostics(state)[0]).toMatchObject({ source: "agent" });
  });

  it("falls through to the chain on invalid directives", async () => {
    const state = freshState();
    const switched: ModelRef[] = [];
    await handleRetry(
      state,
      quotaEvent(),
      async (model) => {
        switched.push(model);
      },
      readerFor(agentFile("# fallback-model: not-a-ref")),
    );
    expect(switched).toEqual([FREE]);
    expect(getFallbackDiagnostics(state)[0]).toMatchObject({ source: "options" });
  });

  it("falls through when the agent model already failed", async () => {
    const state = freshState();
    const switched: ModelRef[] = [];
    const read = readerFor(agentFile("# fallback-model: openai/gpt-5.6-luna"));
    await handleRetry(state, quotaEvent(), async (m) => {
      switched.push(m);
    }, read);
    expect(switched.map((m) => m.id)).toEqual(["muse-spark-1.3-contributor-free"]);
  });

  it("falls through when the file is unreadable", async () => {
    const state = freshState();
    const switched: ModelRef[] = [];
    await handleRetry(
      state,
      quotaEvent(),
      async (model) => {
        switched.push(model);
      },
      async () => {
        throw new Error("ENOENT");
      },
    );
    expect(switched).toEqual([FREE]);
  });

  it("resolveNextModel reports its source", async () => {
    const state = freshState();
    expect(
      await resolveNextModel(state, "explore", new Set(), readerFor(agentFile("# fallback-model: a/b"))),
    ).toEqual({ model: { providerID: "a", id: "b" }, source: "agent" });
    expect(await resolveNextModel(state, "explore", new Set(), readerFor(undefined))).toEqual({
      model: FREE,
      source: "options",
    });
    expect(await resolveNextModel(state, "explore", new Set())).toEqual({
      model: FREE,
      source: "options",
    });
  });
});

describe("failover hook", () => {
  it("switches models and forces a delayed retry on quota errors", async () => {
    const state = freshState();
    const switched: ModelRef[] = [];
    const event = quotaEvent();
    await handleRetry(state, event, async (model) => {
      switched.push(model);
    });
    expect(switched).toEqual([FREE]);
    expect(event.decision).toEqual({ retry: true, delay: 2000 });
    const entries = getFallbackDiagnostics(state);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sessionID: "ses_a",
      agent: "explore",
      from: "openai:gpt-5.6-luna",
      to: "opencode:muse-spark-1.3-contributor-free",
    });
    expect(JSON.stringify(entries)).not.toMatch(/slow down/);
  });

  it("stops after the per-session switch budget is spent", async () => {
    const state = freshState();
    let calls = 0;
    const first = quotaEvent();
    await handleRetry(state, first, async () => {
      calls++;
    });
    expect(calls).toBe(1);
    const second = quotaEvent({
      model: { ...FREE },
      attempt: 2,
      decision: { retry: false },
    });
    await handleRetry(state, second, async () => {
      calls++;
    });
    expect(calls).toBe(1);
    expect(second.decision).toEqual({ retry: false });
    expect(getFallbackDiagnostics(state)).toHaveLength(1);
  });

  it("never retries onto an already-failed model (no ping-pong)", async () => {
    const state = createQuotaState({
      maxSwitchesPerSession: 2,
      fallbacks: [{ model: { ...FREE } }, { model: { ...OPENAI } }],
    });
    const switched: ModelRef[] = [];
    await handleRetry(state, quotaEvent(), async (model) => {
      switched.push(model);
    });
    expect(switched.map((m) => m.id)).toEqual(["muse-spark-1.3-contributor-free"]);
    // Fallback also quota-fails: only the remaining candidate is excluded too.
    await handleRetry(
      state,
      quotaEvent({ model: { ...FREE }, attempt: 2, decision: { retry: false } }),
      async (model) => {
        switched.push(model);
      },
    );
    expect(switched).toHaveLength(1);
  });

  it("leaves non-quota errors to the native policy", async () => {
    const state = freshState();
    let calls = 0;
    const event = quotaEvent({
      error: { type: "provider.invalid-request", message: "bad field", status: 400 },
    });
    await handleRetry(state, event, async () => {
      calls++;
    });
    expect(calls).toBe(0);
    expect(event.decision).toEqual({ retry: false });
    expect(getFallbackDiagnostics(state)).toHaveLength(0);
  });

  it("does nothing when disabled", async () => {
    const state = createQuotaState({ enabled: false });
    let calls = 0;
    const event = quotaEvent();
    await handleRetry(state, event, async () => {
      calls++;
    });
    expect(calls).toBe(0);
    expect(event.decision).toEqual({ retry: false });
  });

  it("keeps the native decision when the switch itself fails", async () => {
    const state = freshState();
    const event = quotaEvent();
    await handleRetry(state, event, async () => {
      throw new Error("switch rejected");
    });
    expect(event.decision).toEqual({ retry: false });
    expect(getFallbackDiagnostics(state)).toHaveLength(0);
  });

  it("honors per-agent preferences", async () => {
    const state = createQuotaState({
      fallbacks: [
        { agents: ["oracle"], model: { providerID: "opencode", id: "big" } },
        { model: { providerID: "opencode", id: "small" } },
      ],
    });
    const switched: ModelRef[] = [];
    await handleRetry(state, quotaEvent({ agent: "oracle" }), async (m) => {
      switched.push(m);
    });
    await handleRetry(state, quotaEvent({ sessionID: "ses_b" }), async (m) => {
      switched.push(m);
    });
    expect(switched.map((m) => m.id)).toEqual(["big", "small"]);
  });

  it("isolates sessions from each other", async () => {
    const state = freshState();
    let calls = 0;
    await handleRetry(state, quotaEvent({ sessionID: "ses_a" }), async () => {
      calls++;
    });
    await handleRetry(state, quotaEvent({ sessionID: "ses_b" }), async () => {
      calls++;
    });
    expect(calls).toBe(2);
    expect(getFallbackDiagnostics(state, "ses_a")).toHaveLength(1);
  });
});

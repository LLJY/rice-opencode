import { describe, expect, it } from "bun:test";
import {
  createRouterState,
  getDiagnostics,
  handleModelContext,
  isChildSession,
  type ContextEvent,
  type RouterState,
  type SessionReader,
} from "./index";

function makeEvent(overrides: Partial<ContextEvent> & { messages: unknown }): ContextEvent {
  return {
    sessionID: "ses_test",
    agent: "explore",
    model: { providerID: "openai", id: "gpt-5.6-luna", variant: "high" },
    providerOptions: {},
    ...overrides,
  };
}

function textEvent(sessionID: string, agent: string, text: string): ContextEvent {
  return makeEvent({
    sessionID,
    agent,
    messages: [{ role: "user", parts: [{ type: "text", text }] }],
  });
}

function freshState(): RouterState {
  return createRouterState(undefined);
}

describe("routing hook", () => {
  it("routes an explicit class and strips the marker", () => {
    const state = freshState();
    const event = textEvent("ses_a", "explore", "[reasoning:fast] Find all config files");
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBe("low");
    expect(JSON.stringify(event.messages)).not.toMatch(/reasoning:fast/);
    expect(JSON.stringify(event.messages)).toMatch(/Find all config files/);
  });

  it("keeps the resolved effort stable across continuations", () => {
    const state = freshState();
    const first = textEvent("ses_a", "explore", "[reasoning:fast] Find all config files");
    handleModelContext(state, first, "openai");
    const continuation = makeEvent({
      sessionID: "ses_a",
      agent: "explore",
      messages: [{ role: "assistant", parts: [{ type: "text", text: "tool result, no marker" }] }],
    });
    handleModelContext(state, continuation, "openai");
    expect(continuation.providerOptions.reasoningEffort).toBe("low");
    expect(state.diagnostics).toHaveLength(1);
  });

  it("strips the marker on continuations whose history still carries it", () => {
    const state = freshState();
    handleModelContext(state, textEvent("ses_a", "explore", "[reasoning:fast] Find configs"), "openai");
    const continuation = textEvent("ses_a", "explore", "[reasoning:fast] Find configs");
    handleModelContext(state, continuation, "openai");
    expect(continuation.providerOptions.reasoningEffort).toBe("low");
    expect(JSON.stringify(continuation.messages)).not.toMatch(/reasoning:/);
    expect(state.diagnostics).toHaveLength(1);
  });

  it("re-resolves when the session switches agents", () => {
    const state = freshState();
    handleModelContext(state, textEvent("ses_a", "oracle", "[reasoning:deep] Diagnose this"), "openai");
    expect(state.sessions.get("ses_a")?.effort).toBe("high");
    const switched = textEvent("ses_a", "explore", "[reasoning:deep] Diagnose this");
    handleModelContext(state, switched, "openai");
    expect(switched.providerOptions.reasoningEffort).toBe("medium");
    expect(state.diagnostics).toHaveLength(2);
    expect(state.diagnostics[1]?.rule).toMatch(/switched agent oracle -> explore/);
    expect(state.sessions.get("ses_a")).toMatchObject({ effort: "medium", agent: "explore" });
  });

  it("honors the configured supported efforts at runtime", () => {
    const state = createRouterState({ supportedEfforts: ["low", "medium"] });
    const event = textEvent("ses_a", "researcher", "[reasoning:deep] Survey the field");
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBe("medium");
    expect(state.diagnostics[0]?.fallback).toMatch(/nearest supported in range/);
  });

  it("applies no override when no supported effort fits the agent range", () => {
    const state = createRouterState({ supportedEfforts: ["low"] });
    const event = textEvent("ses_a", "code-checker", "[reasoning:deep] Review this");
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBeUndefined();
    expect(state.diagnostics[0]?.resolved).toBeNull();
  });

  it("keeps the first resolution when later messages carry another marker", () => {
    const state = freshState();
    handleModelContext(state, textEvent("ses_a", "explore", "[reasoning:fast] go"), "openai");
    const later = textEvent("ses_a", "explore", "[reasoning:deep] escalate please");
    handleModelContext(state, later, "openai");
    expect(later.providerOptions.reasoningEffort).toBe("low");
  });

  it("isolates parallel child sessions", () => {
    const state = freshState();
    const a = textEvent("ses_a", "explore", "[reasoning:fast] task A");
    const b = textEvent("ses_b", "code-checker", "[reasoning:deep] task B");
    handleModelContext(state, a, "openai");
    handleModelContext(state, b, "openai");
    expect(a.providerOptions.reasoningEffort).toBe("low");
    expect(b.providerOptions.reasoningEffort).toBe("high");
    expect(state.sessions.get("ses_a")?.effort).toBe("low");
    expect(state.sessions.get("ses_b")?.effort).toBe("high");
  });

  it("applies the agent default with no marker (auto)", () => {
    const state = freshState();
    const event = textEvent("ses_a", "code-writer", "Implement the scoped step");
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBe("medium");
    expect(state.diagnostics[0]).toMatchObject({ requested: "auto", resolved: "medium" });
  });

  it("clamps requests to the agent range", () => {
    const state = freshState();
    const event = textEvent("ses_a", "tester", "[reasoning:deep] Run the suite");
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBe("medium");
    expect(state.diagnostics[0]?.fallback).toMatch(/maximum/);
  });

  it("escalates one level within the agent cap", () => {
    const state = freshState();
    const event = textEvent("ses_a", "oracle", "[reasoning:deep:escalate] Diagnose this");
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBe("xhigh");
  });
});

describe("scope guards", () => {
  it("leaves non-OpenAI providers untouched and unrecorded", () => {
    const state = freshState();
    const event = makeEvent({
      sessionID: "ses_a",
      agent: "explore",
      model: { providerID: "anthropic", id: "claude" },
      messages: [{ text: "[reasoning:fast] go" }],
    });
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBeUndefined();
    expect(state.diagnostics).toHaveLength(0);
  });

  it("leaves primary and auxiliary agents untouched", () => {
    const state = freshState();
    for (const agent of ["build", "general", "compaction", "title", "summary"]) {
      const event = textEvent(`ses_${agent}`, agent, "[reasoning:deep] go");
      handleModelContext(state, event, "openai");
      expect(event.providerOptions.reasoningEffort).toBeUndefined();
    }
    expect(state.diagnostics).toHaveLength(0);
  });

  it("leaves agents without a policy untouched", () => {
    const state = freshState();
    const event = textEvent("ses_a", "custom-agent", "[reasoning:deep] go");
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBeUndefined();
    expect(state.diagnostics).toHaveLength(0);
  });

  it("treats an invalid marker as auto", () => {
    const state = freshState();
    const event = textEvent("ses_a", "tester", "[reasoning:turbo] go");
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBe("low");
  });

  it("still applies when the model identity is missing (hook is provider-scoped)", () => {
    const state = freshState();
    const event = makeEvent({
      sessionID: "ses_a",
      agent: "explore",
      model: {},
      messages: [{ text: "[reasoning:fast] go" }],
    });
    handleModelContext(state, event, "openai");
    expect(event.providerOptions.reasoningEffort).toBe("low");
  });

  it("never throws on unexpected shapes", () => {
    const state = freshState();
    const event = { sessionID: "ses_a", agent: "explore" } as unknown as ContextEvent;
    expect(() => handleModelContext(state, event, "openai")).not.toThrow();
  });
});

describe("multi-provider rules", () => {
  const acmeState = (): RouterState =>
    createRouterState({
      providers: {
        openai: {},
        acme: { option: "thinkingEffort", efforts: ["low", "medium", "high", "xhigh", "max"] },
      },
    });

  it("routes a configured provider through its own option key", () => {
    const state = acmeState();
    const event = makeEvent({
      sessionID: "ses_a",
      agent: "researcher",
      model: { providerID: "acme", id: "reasoner" },
      messages: [{ text: "[reasoning:deep] Survey the field" }],
    });
    handleModelContext(state, event, "acme");
    expect(event.providerOptions.thinkingEffort).toBe("high");
    expect(event.providerOptions.reasoningEffort).toBeUndefined();
    expect(state.diagnostics[0]).toMatchObject({
      provider: "acme",
      option: "thinkingEffort",
      resolved: "high",
    });
  });

  it("clamps to the provider's own effort levels", () => {
    const state = createRouterState({
      providers: { acme: { option: "thinkingEffort", efforts: ["low", "medium"] } },
    });
    const event = makeEvent({
      sessionID: "ses_a",
      agent: "researcher",
      model: { providerID: "acme", id: "reasoner" },
      messages: [{ text: "[reasoning:deep] Survey the field" }],
    });
    handleModelContext(state, event, "acme");
    expect(event.providerOptions.thinkingEffort).toBe("medium");
  });

  it("leaves unlisted providers untouched and unrecorded", () => {
    const state = freshState();
    const event = makeEvent({
      sessionID: "ses_a",
      agent: "explore",
      model: { providerID: "acme", id: "reasoner" },
      messages: [{ text: "[reasoning:fast] go" }],
    });
    handleModelContext(state, event, "acme");
    expect(event.providerOptions).toEqual({});
    expect(state.diagnostics).toHaveLength(0);
  });

  it("skips when the event model disagrees with the hook scope", () => {
    const state = freshState();
    const event = makeEvent({
      sessionID: "ses_a",
      agent: "explore",
      model: { providerID: "other", id: "x" },
      messages: [{ text: "[reasoning:fast] go" }],
    });
    handleModelContext(state, event, "openai");
    expect(event.providerOptions).toEqual({});
    expect(state.diagnostics).toHaveLength(0);
  });

  it("keeps per-provider sessions independent", () => {
    const state = acmeState();
    const a = makeEvent({
      sessionID: "ses_same",
      agent: "explore",
      model: { providerID: "openai", id: "gpt-5.6-luna" },
      messages: [{ text: "[reasoning:fast] go" }],
    });
    handleModelContext(state, a, "openai");
    expect(a.providerOptions.reasoningEffort).toBe("low");
  });
});

describe("child-session scoping", () => {
  const readerFor = (parentID?: unknown): SessionReader => ({
    getInfo: async () => ({ parentID }),
  });

  it("routes sessions with a parentID and skips roots", async () => {
    const state = freshState();
    expect(await isChildSession(readerFor("ses_parent"), state, "ses_child")).toBe(true);
    expect(await isChildSession(readerFor(undefined), state, "ses_root")).toBe(false);
  });

  it("caches scope lookups per session", async () => {
    const state = freshState();
    let calls = 0;
    const reader: SessionReader = {
      getInfo: async () => {
        calls++;
        return { parentID: "ses_parent" };
      },
    };
    expect(await isChildSession(reader, state, "ses_a")).toBe(true);
    expect(await isChildSession(reader, state, "ses_a")).toBe(true);
    expect(calls).toBe(1);
  });

  it("fails open without caching when the lookup fails", async () => {
    const state = freshState();
    const reader: SessionReader = {
      getInfo: async () => {
        throw new Error("metadata unavailable");
      },
    };
    expect(await isChildSession(reader, state, "ses_a")).toBe(true);
    expect(state.parents.has("ses_a")).toBe(false);
  });
});

describe("diagnostics", () => {
  it("records routing without prompt content", () => {
    const state = freshState();
    handleModelContext(state, textEvent("ses_secret", "explore", "[reasoning:fast] SECRET-TASK-abc123"), "openai");
    const entries = getDiagnostics(state);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sessionID: "ses_secret",
      agent: "explore",
      requested: "fast",
      resolved: "low",
    });
    expect(JSON.stringify(entries)).not.toMatch(/SECRET-TASK/);
    expect(typeof entries[0]?.rule).toBe("string");
  });

  it("filters diagnostics by session", () => {
    const state = freshState();
    handleModelContext(state, textEvent("ses_a", "explore", "[reasoning:fast] A"), "openai");
    handleModelContext(state, textEvent("ses_b", "tester", "B"), "openai");
    expect(getDiagnostics(state, "ses_a")).toHaveLength(1);
    expect(getDiagnostics(state)).toHaveLength(2);
  });

  it("caps stored diagnostics at the configured limit", () => {
    const state = createRouterState({ diagnosticsLimit: 2 });
    handleModelContext(state, textEvent("ses_a", "explore", "A"), "openai");
    handleModelContext(state, textEvent("ses_b", "explore", "B"), "openai");
    handleModelContext(state, textEvent("ses_c", "explore", "C"), "openai");
    const entries = getDiagnostics(state);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.sessionID).toBe("ses_b");
  });
});

import { describe, expect, it } from "bun:test";
import {
  createRouterState,
  getDiagnostics,
  handleModelContext,
  type ContextEvent,
} from "./index";

function eventFor(
  sessionID: string,
  agent: string,
  modelID: string,
  text: string,
): ContextEvent {
  return {
    sessionID,
    agent,
    model: { providerID: "openai", id: modelID, variant: "high" },
    messages: [{ role: "user", parts: [{ type: "text", text }] }],
    providerOptions: {},
  };
}

describe("long-context (-1m) model compatibility", () => {
  it("routes each -1m tier variant like its base model", () => {
    const cases = [
      { agent: "explore", modelID: "gpt-5.6-luna-1m", expected: "medium" },
      { agent: "code-writer", modelID: "gpt-5.6-luna-1m", expected: "high" },
      { agent: "researcher", modelID: "gpt-5.6-terra-1m", expected: "high" },
      { agent: "plan", modelID: "gpt-5.6-sol-1m", expected: "high" },
      { agent: "oracle", modelID: "gpt-5.6-sol-1m", expected: "high" },
    ] as const;
    for (const { agent, modelID, expected } of cases) {
      const state = createRouterState(undefined);
      const event = eventFor(
        `ses_${agent}_${modelID}`,
        agent,
        modelID,
        "[reasoning:deep] Diagnose this",
      );
      handleModelContext(state, event, "openai");
      expect(event.providerOptions.reasoningEffort).toBe(expected);
    }
  });

  it("records the -1m model label in diagnostics without prompt content", () => {
    const state = createRouterState(undefined);
    const event = eventFor(
      "ses_secret",
      "explore",
      "gpt-5.6-terra-1m",
      "[reasoning:fast] SECRET-TASK-abc123",
    );
    handleModelContext(state, event, "openai");
    const entries = getDiagnostics(state);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      model: "openai/gpt-5.6-terra-1m#high",
      requested: "fast",
      resolved: "low",
    });
    expect(JSON.stringify(entries)).not.toMatch(/SECRET-TASK/);
  });

  it("keeps -1m sessions isolated per child session", () => {
    const state = createRouterState(undefined);
    const a = eventFor("ses_a", "explore", "gpt-5.6-luna-1m", "[reasoning:fast] A");
    const b = eventFor("ses_b", "oracle", "gpt-5.6-sol-1m", "[reasoning:deep] B");
    handleModelContext(state, a, "openai");
    handleModelContext(state, b, "openai");
    expect(a.providerOptions.reasoningEffort).toBe("low");
    expect(b.providerOptions.reasoningEffort).toBe("high");
  });
});

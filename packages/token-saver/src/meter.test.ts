import { describe, expect, it } from "bun:test";

import { getStatus, createTokenSaverState } from "./index";

describe("meter + status", () => {
  it("aggregates per-tool sizes and renders a status payload", () => {
    const state = createTokenSaverState({});
    state.meter.record("ses_1", "read", 400, 4000, false);
    state.meter.record("ses_1", "read", 400, 4000, false);
    state.meter.record("ses_1", "grep", 80, 0, true);
    state.meter.record("ses_2", "read", 400, 400, false);

    const all = JSON.parse(getStatus(state)) as {
      calls: number;
      inputTokens: number;
      byTool: string[];
    };
    expect(all.calls).toBe(4);
    expect(all.inputTokens).toBe(100 + 100 + 20 + 100);
    expect(all.byTool[0]).toMatch(/^read: 3 calls/);

    const one = JSON.parse(getStatus(state, "ses_1")) as { calls: number; sessions: number };
    expect(one).toMatchObject({ calls: 3, sessions: 1 });

    const limited = JSON.parse(getStatus(state, undefined, 1)) as { byTool: string[] };
    expect(limited.byTool).toHaveLength(1);
  });
});

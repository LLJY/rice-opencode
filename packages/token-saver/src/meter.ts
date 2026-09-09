/**
 * Pure metering aggregation for the token-saver plugin (V2-only).
 *
 * No OpenCode imports: deterministic, side-effect free, unit tested.
 * Only sizes are stored — never prompt content or tool results.
 */

import { estimateTokensForLength } from "./policy";

export interface ToolAggregate {
  tool: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

export interface MeterSnapshot {
  sessions: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  byTool: ToolAggregate[];
}

function emptyAggregate(tool: string): ToolAggregate {
  return { tool, calls: 0, errors: 0, inputTokens: 0, outputTokens: 0 };
}

export class MeterStore {
  /** sessionID -> tool name -> aggregate. Sizes only, no content. */
  private sessions = new Map<string, Map<string, ToolAggregate>>();

  /** One call = input chars + output chars + error flag. Called from execute.after. */
  record(sessionID: string, tool: string, inputChars: number, outputChars: number, error: boolean): void {
    let tools = this.sessions.get(sessionID);
    if (!tools) {
      tools = new Map();
      this.sessions.set(sessionID, tools);
    }
    let agg = tools.get(tool);
    if (!agg) {
      agg = emptyAggregate(tool);
      tools.set(tool, agg);
    }
    agg.calls += 1;
    if (error) agg.errors += 1;
    agg.inputTokens += estimateTokensForLength(inputChars);
    agg.outputTokens += estimateTokensForLength(outputChars);
  }

  snapshot(sessionID?: string): MeterSnapshot {
    const byTool = new Map<string, ToolAggregate>();
    let sessions = 0;
    for (const [sid, tools] of this.sessions) {
      if (sessionID !== undefined && sid !== sessionID) continue;
      sessions += 1;
      for (const [name, agg] of tools) {
        let total = byTool.get(name);
        if (!total) {
          total = emptyAggregate(name);
          byTool.set(name, total);
        }
        total.calls += agg.calls;
        total.errors += agg.errors;
        total.inputTokens += agg.inputTokens;
        total.outputTokens += agg.outputTokens;
      }
    }
    const list = [...byTool.values()].sort(
      (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
    );
    const totals = list.reduce(
      (acc, t) => ({ calls: acc.calls + t.calls, input: acc.input + t.inputTokens, output: acc.output + t.outputTokens }),
      { calls: 0, input: 0, output: 0 },
    );
    return { sessions, calls: totals.calls, inputTokens: totals.input, outputTokens: totals.output, byTool: list };
  }
}

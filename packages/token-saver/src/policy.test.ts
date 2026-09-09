import { describe, expect, it } from "bun:test";

import {
  estimateTokens,
  estimateTokensForLength,
  sizableText,
  validateOptions,
} from "./policy";

describe("estimateTokens", () => {
  it("uses the chars/4 heuristic with a minimum of 1", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hi")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("estimates from lengths without allocating", () => {
    expect(estimateTokensForLength(0)).toBe(0);
    expect(estimateTokensForLength(-5)).toBe(0);
    expect(estimateTokensForLength(4_000_000)).toBe(1_000_000);
    expect(estimateTokensForLength(Number.NaN)).toBe(0);
  });
});

describe("sizableText", () => {
  it("passes strings through and stringifies the rest without throwing", () => {
    expect(sizableText("hello")).toBe("hello");
    expect(sizableText({ a: 1 })).toBe('{"a":1}');
    expect(sizableText(undefined)).toBe("");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sizableText(circular)).toBe("");
  });
});

describe("validateOptions", () => {
  it("defaults to meter-only when options are absent", () => {
    expect(validateOptions()).toEqual({
      diagnosticsLimit: 100,
      patterns: { meter: true, slimmer: false, pruner: false },
      maxResultChars: 12_000,
    });
  });

  it("accepts explicit toggles and rejects bad shapes", () => {
    const opts = validateOptions({ patterns: { slimmer: true }, diagnosticsLimit: 10 });
    expect(opts.patterns).toEqual({ meter: true, slimmer: true, pruner: false });
    expect(opts.diagnosticsLimit).toBe(10);
    expect(() => validateOptions({ diagnosticsLimit: 0 })).toThrow();
    expect(() => validateOptions("nope")).toThrow();
  });
});

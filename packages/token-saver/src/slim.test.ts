import { describe, expect, it } from "bun:test";

import { collapseWhitespace, compactResultText, shortenDescription } from "./slim";

describe("slim", () => {
  it("collapses whitespace runs", () => {
    const { text, saved } = collapseWhitespace("a   b\n\n\n\nc  ");
    expect(text).toBe("a b\n\nc");
    expect(saved).toBeGreaterThan(0);
  });

  it("returns null for already-tight descriptions", () => {
    expect(shortenDescription("Read a file.")).toBeNull();
  });

  it("caps long descriptions with an ellipsis", () => {
    const long = "word ".repeat(200);
    const short = shortenDescription(long, 100)!;
    expect(short.length).toBeLessThanOrEqual(101);
    expect(short.endsWith("…")).toBe(true);
  });

  it("passes short results through and marks truncation", () => {
    expect(compactResultText("ok", 100).truncated).toBe(false);
    const big = compactResultText("x".repeat(1000), 100);
    expect(big.truncated).toBe(true);
    expect(big.text).toContain("token-saver: truncated");
    expect(big.text.length).toBeLessThan(1000);
  });
});

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FALLBACK_MODEL,
  extractAgentFallbackModel,
  isQuotaError,
  modelKey,
  parseModelRef,
  selectFallback,
  validateQuotaOptions,
} from "./policy";

describe("quota classifier", () => {
  it("matches 429 status regardless of text", () => {
    expect(isQuotaError({ type: "provider.unknown", message: "boom", status: 429 })).toBe(true);
  });

  it("matches quota/rate-limit/capacity error types", () => {
    for (const type of [
      "provider.rate-limited",
      "provider.rate_limit_exceeded",
      "provider.quota-exceeded",
      "provider.insufficient_quota",
      "provider.capacity",
      "provider.too-many-requests",
    ]) {
      expect(isQuotaError({ type, message: "" })).toBe(true);
    }
  });

  it("matches quota/rate-limit messages", () => {
    expect(isQuotaError({ type: "provider.error", message: "Rate limit reached, retry later" })).toBe(true);
    expect(isQuotaError({ type: "provider.error", message: "You exceeded your current quota" })).toBe(true);
    expect(isQuotaError({ type: "provider.error", message: "HTTP 429: too many requests" })).toBe(true);
  });

  it("never matches auth, validation, or server errors", () => {
    expect(isQuotaError({ type: "provider.invalid-request", message: "bad field", status: 400 })).toBe(false);
    expect(isQuotaError({ type: "provider.auth", message: "invalid api key", status: 401 })).toBe(false);
    expect(isQuotaError({ type: "provider.internal", message: "boom", status: 500 })).toBe(false);
    expect(isQuotaError({ type: "", message: "" })).toBe(false);
  });
});

describe("fallback selection", () => {
  const options = validateQuotaOptions({
    fallbacks: [
      { agents: ["oracle"], model: { providerID: "opencode", id: "big-model" } },
      { model: { providerID: "opencode", id: "small-model" } },
    ],
  });

  it("prefers the first matching entry", () => {
    expect(selectFallback(options, "oracle", new Set())?.id).toBe("big-model");
    expect(selectFallback(options, "explore", new Set())?.id).toBe("small-model");
  });

  it("skips excluded (failed/active) models", () => {
    expect(
      selectFallback(options, "oracle", new Set(["opencode:big-model"]))?.id,
    ).toBe("small-model");
    expect(
      selectFallback(options, "explore", new Set(["opencode:small-model"])),
    ).toBeUndefined();
  });

  it("builds stable model keys", () => {
    expect(modelKey({ providerID: "openai", id: "gpt-x" })).toBe("openai:gpt-x");
    expect(modelKey({})).toBe("?:?");
  });
});

describe("model reference parsing", () => {
  it("parses provider/model with optional variant", () => {
    expect(parseModelRef("opencode/muse-spark-1.3-contributor-free")).toEqual({
      providerID: "opencode",
      id: "muse-spark-1.3-contributor-free",
    });
    expect(parseModelRef("openai/gpt-5.6-sol#high")).toEqual({
      providerID: "openai",
      id: "gpt-5.6-sol",
      variant: "high",
    });
  });

  it("rejects malformed references", () => {
    for (const bad of ["", "   ", "gpt-5.6-sol", "openai/", "/model", 42, undefined]) {
      expect(() => parseModelRef(bad)).toThrow(/model reference|must be a string/);
    }
  });
});

describe("agent fallback directive", () => {
  const file = (body: string): string => `---\ndescription: x\nmode: subagent\n${body}\n---\n\nPrompt here.`;

  it("reads the commented directive below model", () => {
    expect(
      extractAgentFallbackModel(file("model: openai/gpt-5.6-sol#high\n# fallback-model: opencode/muse-spark")),
    ).toBe("opencode/muse-spark");
  });

  it("strips quotes and tolerates spacing", () => {
    expect(
      extractAgentFallbackModel(file("#fallback-model:  'openai/gpt-x#low'  ")),
    ).toBe("openai/gpt-x#low");
  });

  it("ignores bare keys that would leak into request bodies", () => {
    expect(extractAgentFallbackModel(file("fallback-model: opencode/muse-spark"))).toBeUndefined();
  });

  it("returns undefined without a directive", () => {
    expect(extractAgentFallbackModel(file("model: openai/gpt-x"))).toBeUndefined();
    expect(extractAgentFallbackModel("no frontmatter at all")).toBeUndefined();
    expect(extractAgentFallbackModel(undefined)).toBeUndefined();
  });
});

describe("option validation", () => {
  it("applies safe defaults", () => {
    const options = validateQuotaOptions(undefined);
    expect(options.enabled).toBe(true);
    expect(options.retryDelayMs).toBe(2000);
    expect(options.maxSwitchesPerSession).toBe(1);
    expect(options.fallbacks).toEqual([{ model: DEFAULT_FALLBACK_MODEL }]);
  });

  it("accepts per-agent preferences", () => {
    const options = validateQuotaOptions({
      enabled: true,
      retryDelayMs: 5000,
      maxSwitchesPerSession: 2,
      fallbacks: [
        { agents: ["oracle", "plan"], model: { providerID: "opencode", id: "m1", variant: "high" } },
        { model: { providerID: "other", id: "m2" } },
      ],
    });
    expect(options.fallbacks).toHaveLength(2);
    expect(options.fallbacks[0]?.agents).toEqual(["oracle", "plan"]);
    expect(options.fallbacks[0]?.model).toEqual({ providerID: "opencode", id: "m1", variant: "high" });
  });

  it("rejects invalid config", () => {
    expect(() => validateQuotaOptions({ bogus: true })).toThrow(/unknown option/);
    expect(() => validateQuotaOptions({ enabled: "yes" })).toThrow(/enabled/);
    expect(() => validateQuotaOptions({ retryDelayMs: -1 })).toThrow(/retryDelayMs/);
    expect(() => validateQuotaOptions({ maxSwitchesPerSession: 9 })).toThrow(/maxSwitchesPerSession/);
    expect(() => validateQuotaOptions({ fallbacks: "x" })).toThrow(/must be an array/);
    expect(() => validateQuotaOptions({ fallbacks: [] })).toThrow(/must not be empty/);
    expect(() => validateQuotaOptions({ fallbacks: [{ agents: [], model: { providerID: "a", id: "b" } }] })).toThrow(/non-empty array/);
    expect(() => validateQuotaOptions({ fallbacks: [{ model: { providerID: "", id: "b" } }] })).toThrow(/providerID/);
    expect(() => validateQuotaOptions({ fallbacks: [{ model: { providerID: "a" } }] })).toThrow(/\.id must be/);
    expect(() => validateQuotaOptions({ fallbacks: [{ model: { providerID: "a", id: "b" }, extra: 1 }] })).toThrow(/unknown .* key/);
  });

  it("allows an empty list only when disabled", () => {
    const options = validateQuotaOptions({ enabled: false, fallbacks: [] });
    expect(options.enabled).toBe(false);
    expect(options.fallbacks).toEqual([]);
  });
});

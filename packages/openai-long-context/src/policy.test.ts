import { describe, expect, it } from "bun:test";
import {
  collectTargets,
  DEFAULT_LIMIT,
  DEFAULT_MODEL_PREFIX,
  DEFAULT_PROVIDER_ID,
  DEFAULT_SUFFIX,
  isEligibleModelId,
  longModelId,
  longModelName,
  validateOptions,
} from "./policy";

describe("eligibility", () => {
  it("matches the gpt-5.6 prefix and skips existing -1m variants", () => {
    expect(isEligibleModelId("gpt-5.6-terra")).toBe(true);
    expect(isEligibleModelId("gpt-5.6-luna-fast")).toBe(true);
    expect(isEligibleModelId("gpt-5.6-terra-1m")).toBe(false);
    expect(isEligibleModelId("gpt-5.5-turbo")).toBe(false);
    expect(isEligibleModelId("gpt-4o")).toBe(false);
    expect(isEligibleModelId(undefined)).toBe(false);
    expect(isEligibleModelId(42)).toBe(false);
  });

  it("honors custom prefix/suffix pairs", () => {
    expect(isEligibleModelId("acme-reasoner", "acme-", "-long")).toBe(true);
    expect(isEligibleModelId("acme-reasoner-long", "acme-", "-long")).toBe(false);
    expect(isEligibleModelId("other-reasoner", "acme-", "-long")).toBe(false);
  });

  it("builds variant IDs and names", () => {
    expect(longModelId("gpt-5.6-terra")).toBe("gpt-5.6-terra-1m");
    expect(longModelId("acme-x", "-long")).toBe("acme-x-long");
    expect(longModelName("Terra")).toBe("Terra (1M context)");
    expect(longModelName("X", " (long)")).toBe("X (long)");
  });

  it("collects eligible targets in catalog order", () => {
    const targets = collectTargets([
      { id: "gpt-5.6-terra", name: "Terra" },
      { id: "gpt-4o", name: "4o" },
      { id: "gpt-5.6-terra-1m", name: "Terra 1M" },
      { id: "gpt-5.6-sol", name: "Sol" },
    ]);
    expect(targets).toEqual(["gpt-5.6-terra", "gpt-5.6-sol"]);
  });
});

describe("option validation", () => {
  it("applies the 1M defaults", () => {
    const options = validateOptions(undefined);
    expect(options.enabled).toBe(true);
    expect(options.providerID).toBe(DEFAULT_PROVIDER_ID);
    expect(options.modelPrefix).toBe(DEFAULT_MODEL_PREFIX);
    expect(options.suffix).toBe(DEFAULT_SUFFIX);
    expect(options.limit).toEqual({ ...DEFAULT_LIMIT });
  });

  it("accepts scoped overrides", () => {
    const options = validateOptions({
      providerID: "acme",
      modelPrefix: "acme-",
      suffix: "-long",
      nameSuffix: " (long)",
      limit: { context: 500_000, input: 400_000, output: 64_000 },
    });
    expect(options.providerID).toBe("acme");
    expect(options.modelPrefix).toBe("acme-");
    expect(options.suffix).toBe("-long");
    expect(options.nameSuffix).toBe(" (long)");
    expect(options.limit).toEqual({ context: 500_000, input: 400_000, output: 64_000 });
  });

  it("rejects unknown keys and invalid values", () => {
    expect(() => validateOptions({ bogus: true })).toThrow(/unknown option/);
    expect(() => validateOptions({ enabled: "yes" })).toThrow(/enabled/);
    expect(() => validateOptions({ providerID: "" })).toThrow(/providerID/);
    expect(() => validateOptions({ modelPrefix: "" })).toThrow(/modelPrefix/);
    expect(() => validateOptions({ suffix: "" })).toThrow(/suffix/);
    expect(() => validateOptions({ nameSuffix: "" })).toThrow(/nameSuffix/);
    expect(() => validateOptions({ limit: "big" })).toThrow(/limit must be an object/);
    expect(() => validateOptions({ limit: { context: 0, input: 1, output: 1 } })).toThrow(
      /limit\.context/,
    );
    expect(() => validateOptions({ limit: { context: 100, input: 200, output: 10 } })).toThrow(
      /must not exceed/,
    );
    expect(() =>
      validateOptions({ limit: { context: 100, input: 50, output: 200 } }),
    ).toThrow(/must not exceed/);
    expect(() =>
      validateOptions({ limit: { context: 100, input: 50, output: 50, extra: 1 } }),
    ).toThrow(/unknown options\.limit key/);
  });
});

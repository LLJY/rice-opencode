import { describe, expect, it } from "bun:test";
import {
  CLASS_BASE_EFFORT,
  collectMessageText,
  DEFAULT_AGENT_POLICY,
  EFFORTS,
  IGNORED_AGENTS,
  isEffort,
  isReasoningClass,
  parseReasoningMarker,
  providerRuleFor,
  resolveReasoningEffort,
  stripReasoningMarkers,
  validateOptions,
} from "./policy";

describe("semantic-class mapping", () => {
  it("maps fast/balanced/deep to low/medium/high base efforts", () => {
    expect(CLASS_BASE_EFFORT.fast).toBe("low");
    expect(CLASS_BASE_EFFORT.balanced).toBe("medium");
    expect(CLASS_BASE_EFFORT.deep).toBe("high");
  });

  it("resolves auto to the agent default", () => {
    expect(resolveReasoningEffort({ agent: "explore", requested: "auto" }).effort).toBe("low");
    expect(resolveReasoningEffort({ agent: "code-writer", requested: "auto" }).effort).toBe("medium");
    expect(resolveReasoningEffort({ agent: "code-checker", requested: "auto" }).effort).toBe("high");
    expect(resolveReasoningEffort({ agent: "oracle", requested: "auto" }).effort).toBe("xhigh");
  });

  it("treats a missing class as auto", () => {
    const result = resolveReasoningEffort({ agent: "tester" });
    expect(result.effort).toBe("low");
    expect(result.requested).toBe("auto");
    expect(result.fallback).toBeUndefined();
  });
});

describe("initial policy table", () => {
  it("matches the plan defaults and ranges", () => {
    expect(DEFAULT_AGENT_POLICY.explore).toEqual({ def: "low", min: "low", max: "medium" });
    expect(DEFAULT_AGENT_POLICY.tester).toEqual({ def: "low", min: "low", max: "medium" });
    expect(DEFAULT_AGENT_POLICY["code-writer"]).toEqual({ def: "medium", min: "medium", max: "high" });
    expect(DEFAULT_AGENT_POLICY["frontend-engineer"]).toEqual({ def: "medium", min: "medium", max: "high" });
    expect(DEFAULT_AGENT_POLICY.researcher).toEqual({ def: "medium", min: "low", max: "high" });
    expect(DEFAULT_AGENT_POLICY["document-writer"]).toEqual({ def: "medium", min: "low", max: "high" });
    expect(DEFAULT_AGENT_POLICY["document-proofreader"]).toEqual({ def: "medium", min: "low", max: "high" });
    expect(DEFAULT_AGENT_POLICY.plan).toEqual({ def: "high", min: "medium", max: "high" });
    expect(DEFAULT_AGENT_POLICY["plan-checker"]).toEqual({ def: "high", min: "medium", max: "high" });
    expect(DEFAULT_AGENT_POLICY["code-checker"]).toEqual({ def: "high", min: "medium", max: "high" });
    expect(DEFAULT_AGENT_POLICY.oracle).toEqual({ def: "xhigh", min: "high", max: "max" });
  });
});

describe("agent caps", () => {
  it("clamps fast below the agent minimum", () => {
    const result = resolveReasoningEffort({ agent: "code-writer", requested: "fast" });
    expect(result.effort).toBe("medium");
    expect(result.fallback).toMatch(/minimum/);
  });

  it("clamps deep above the agent maximum", () => {
    const result = resolveReasoningEffort({ agent: "tester", requested: "deep" });
    expect(result.effort).toBe("medium");
    expect(result.fallback).toMatch(/maximum/);
  });

  it("keeps in-range requests unchanged without fallback notes", () => {
    const result = resolveReasoningEffort({ agent: "researcher", requested: "deep" });
    expect(result.effort).toBe("high");
    expect(result.fallback).toBeUndefined();
  });

  it("never lets oracle exceed max", () => {
    const result = resolveReasoningEffort({ agent: "oracle", requested: "deep", escalate: true });
    expect(result.effort).toBe("xhigh");
  });
});

describe("escalation", () => {
  it("escalates one level within range", () => {
    const result = resolveReasoningEffort({ agent: "researcher", requested: "balanced", escalate: true });
    expect(result.effort).toBe("high");
    expect(result.fallback).toMatch(/escalated/);
  });

  it("caps escalation at the agent maximum", () => {
    const result = resolveReasoningEffort({ agent: "code-checker", requested: "deep", escalate: true });
    expect(result.effort).toBe("high");
    expect(result.fallback).toMatch(/capped/);
  });

  it("escalates auto from the agent default", () => {
    const result = resolveReasoningEffort({ agent: "explore", escalate: true });
    expect(result.effort).toBe("medium");
  });
});

describe("model capability clamping", () => {
  it("picks the nearest supported effort at or below the target", () => {
    const result = resolveReasoningEffort({
      agent: "researcher",
      requested: "deep",
      supported: ["low", "medium"],
    });
    expect(result.effort).toBe("medium");
    expect(result.fallback).toMatch(/nearest supported/);
  });

  it("falls back to the lowest supported effort above the target", () => {
    const result = resolveReasoningEffort({
      agent: "researcher",
      requested: "fast",
      supported: ["medium", "high"],
    });
    expect(result.effort).toBe("medium");
  });

  it("never exceeds the agent maximum for out-of-range support", () => {
    const result = resolveReasoningEffort({
      agent: "explore",
      requested: "fast",
      supported: ["high"],
    });
    expect(result.effort).toBeUndefined();
    expect(result.fallback).toMatch(/within the agent range/);
  });

  it("applies no override when the intersection is empty", () => {
    const result = resolveReasoningEffort({
      agent: "code-checker",
      requested: "deep",
      supported: ["low"],
    });
    expect(result.effort).toBeUndefined();
    expect(result.fallback).toMatch(/within the agent range/);
  });

  it("ignores unknown supported entries", () => {
    const result = resolveReasoningEffort({
      agent: "explore",
      requested: "fast",
      supported: ["turbo", "low"],
    });
    expect(result.effort).toBe("low");
  });

  it("applies no override when nothing is supported", () => {
    const result = resolveReasoningEffort({
      agent: "explore",
      requested: "fast",
      supported: [],
    });
    expect(result.effort).toBeUndefined();
    expect(result.fallback).toMatch(/within the agent range/);
  });
});

describe("fallback behavior", () => {
  it("passes unknown agents through without an override", () => {
    const result = resolveReasoningEffort({ agent: "custom-agent", requested: "deep" });
    expect(result.effort).toBeUndefined();
    expect(result.fallback).toMatch(/unknown agent/);
  });

  it("falls back to auto on an invalid class", () => {
    const result = resolveReasoningEffort({ agent: "tester", requested: "turbo" });
    expect(result.effort).toBe("low");
    expect(result.requested).toBe("auto");
    expect(result.fallback).toMatch(/invalid class/);
  });
});

describe("marker parsing", () => {
  it("parses each class", () => {
    expect(parseReasoningMarker("[reasoning:fast]")).toEqual({ requested: "fast", escalate: false });
    expect(parseReasoningMarker("[reasoning:balanced]")).toEqual({ requested: "balanced", escalate: false });
    expect(parseReasoningMarker("[reasoning:deep]")).toEqual({ requested: "deep", escalate: false });
    expect(parseReasoningMarker("[reasoning:auto]")).toEqual({ requested: "auto", escalate: false });
  });

  it("parses escalation suffixes case-insensitively with whitespace", () => {
    expect(parseReasoningMarker("[reasoning:deep:escalate]")).toEqual({ requested: "deep", escalate: true });
    expect(parseReasoningMarker("[Reasoning:Fast+Escalate]")).toEqual({ requested: "fast", escalate: true });
    expect(parseReasoningMarker("[reasoning : balanced : escalate]")).toEqual({ requested: "balanced", escalate: true });
  });

  it("finds markers embedded in task text and lets the first win", () => {
    const marker = parseReasoningMarker("Fix the bug\n[reasoning:deep]\nMore detail [reasoning:fast]");
    expect(marker).toEqual({ requested: "deep", escalate: false });
  });

  it("returns undefined without a marker", () => {
    expect(parseReasoningMarker("Just do the thing")).toBeUndefined();
    expect(parseReasoningMarker("[reasoning:turbo]")).toBeUndefined();
  });
});

describe("marker stripping", () => {
  it("removes markers from nested message graphs", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "[reasoning:fast] Find foo" }] },
      { role: "assistant", content: "nothing to strip" },
    ];
    expect(stripReasoningMarkers(messages)).toBe(1);
    const first = messages[0];
    if (!("parts" in first) || !Array.isArray(first.parts) || first.parts.length === 0) {
      throw new Error("expected parts on first message");
    }
    const text = (first.parts[0] as { text: string }).text;
    expect(text).toBe(" Find foo");
  });

  it("is safe on cyclic graphs", () => {
    const node: Record<string, unknown> = { text: "hi [reasoning:deep]" };
    node.self = node;
    expect(stripReasoningMarkers(node)).toBe(1);
    expect(node.text).toBe("hi ");
  });

  it("collects only marker-bearing text for routing", () => {
    const text = collectMessageText([{ content: "Locate [reasoning:balanced] the config" }]);
    expect(text).toMatch(/reasoning:balanced/);
    expect(collectMessageText([{ content: "no marker here" }])).toBe("");
  });
});

describe("option validation", () => {
  it("applies conservative defaults", () => {
    const options = validateOptions(undefined);
    expect(options.diagnosticsLimit).toBe(100);
    expect(options.supportedEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(options.providers).toEqual({
      openai: { option: "reasoningEffort", efforts: ["low", "medium", "high", "xhigh", "max"] },
    });
    expect(options.agentPolicy.explore).toEqual({ def: "low", min: "low", max: "medium" });
  });

  it("accepts scoped overrides", () => {
    const options = validateOptions({
      diagnosticsLimit: 10,
      agentPolicy: { explore: { def: "medium", min: "low", max: "medium" } },
      classBase: { fast: "medium" },
      supportedEfforts: ["low", "medium"],
      providers: { openai: {}, acme: { option: "thinkingEffort" } },
    });
    expect(options.diagnosticsLimit).toBe(10);
    expect(options.agentPolicy.explore?.def).toBe("medium");
    expect(options.classBase.fast).toBe("medium");
    expect(options.supportedEfforts).toEqual(["low", "medium"]);
    expect(options.providers.openai).toEqual({ option: "reasoningEffort", efforts: ["low", "medium"] });
    expect(options.providers.acme).toEqual({ option: "thinkingEffort", efforts: ["low", "medium"] });
    expect(options.agentPolicy.oracle).toEqual({ def: "xhigh", min: "high", max: "max" });
  });

  it("rejects unknown keys and invalid values", () => {
    expect(() => validateOptions({ bogus: true })).toThrow(/unknown option/);
    expect(() => validateOptions({ providerID: "openai" })).toThrow(/unknown option/);
    expect(() => validateOptions({ diagnosticsLimit: 0 })).toThrow(/diagnosticsLimit/);
    expect(() => validateOptions({ supportedEfforts: "low" })).toThrow(/must be an array/);
    expect(() => validateOptions({ supportedEfforts: ["low", "turbo"] })).toThrow(/must be one of/);
    expect(() => validateOptions({ providers: { acme: { bogus: 1 } } })).toThrow(/unknown providers/);
    expect(() => validateOptions({ providers: { acme: { option: "" } } })).toThrow(/non-empty string/);
    expect(() => validateOptions({ providers: { acme: { efforts: [] } } })).toThrow(/non-empty array/);
    expect(() => validateOptions({ providers: { acme: { efforts: ["turbo"] } } })).toThrow(/must be one of/);
    expect(() => validateOptions({ agentPolicy: { explore: { def: "turbo", min: "low", max: "medium" } } })).toThrow(/must be one of/);
    expect(() => validateOptions({ agentPolicy: { explore: { def: "low", min: "medium", max: "low" } } })).toThrow(/must not exceed/);
    expect(() => validateOptions({ classBase: { auto: "low" } })).toThrow(/must not override/);
  });
});

describe("provider rules", () => {
  it("resolves rules for listed providers only", () => {
    const options = validateOptions(undefined);
    expect(providerRuleFor(options, "openai")).toEqual({
      option: "reasoningEffort",
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(providerRuleFor(options, "acme")).toBeUndefined();
    expect(providerRuleFor(options, undefined)).toBeUndefined();
  });
});

describe("guards", () => {
  it("recognizes efforts and classes", () => {
    for (const effort of EFFORTS) expect(isEffort(effort)).toBe(true);
    expect(isEffort("turbo")).toBe(false);
    expect(isReasoningClass("deep")).toBe(true);
    expect(isReasoningClass("xhigh")).toBe(false);
  });

  it("ignores primary and auxiliary agents", () => {
    for (const agent of ["build", "general", "compaction", "title", "summary"]) {
      expect(IGNORED_AGENTS.has(agent)).toBe(true);
    }
  });
});

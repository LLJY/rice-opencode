/**
 * Pure policy resolver for the reasoning-router plugin (V2-only).
 *
 * No OpenCode imports here: this module is deterministic, side-effect free,
 * and covered by unit tests. The plugin hook in `./index.ts` owns session
 * state and OpenCode wiring.
 */

/** Reasoning-effort ladder, cheapest first. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof EFFORTS)[number];

/** Semantic classes a parent may request. Never a raw effort value. */
export const REASONING_CLASSES = ["auto", "fast", "balanced", "deep"] as const;
export type ReasoningClass = (typeof REASONING_CLASSES)[number];

export interface AgentPolicy {
  /** Effort used for `auto` (no explicit class). */
  def: ReasoningEffort;
  /** Cheapest effort this agent may receive. */
  min: ReasoningEffort;
  /** Most expensive effort this agent may receive. Never exceeded. */
  max: ReasoningEffort;
}

/** Initial policy from plan.md. */
export const DEFAULT_AGENT_POLICY: Readonly<Record<string, AgentPolicy>> = {
  explore: { def: "low", min: "low", max: "medium" },
  tester: { def: "low", min: "low", max: "medium" },
  "code-writer": { def: "medium", min: "medium", max: "high" },
  "frontend-engineer": { def: "medium", min: "medium", max: "high" },
  researcher: { def: "medium", min: "low", max: "high" },
  "document-writer": { def: "medium", min: "low", max: "high" },
  "document-proofreader": { def: "medium", min: "low", max: "high" },
  plan: { def: "high", min: "medium", max: "high" },
  "plan-checker": { def: "high", min: "medium", max: "high" },
  "code-checker": { def: "high", min: "medium", max: "high" },
  oracle: { def: "xhigh", min: "high", max: "max" },
};

/** Base effort for each explicit class. `auto` resolves to the agent default. */
export const CLASS_BASE_EFFORT: Readonly<
  Record<Exclude<ReasoningClass, "auto">, ReasoningEffort>
> = {
  fast: "low",
  balanced: "medium",
  deep: "high",
};

/**
 * Agents that are never routed. Primary/orchestrator and auxiliary agents
 * keep their configured model variant untouched.
 */
export const IGNORED_AGENTS: ReadonlySet<string> = new Set([
  "build",
  "general",
  "compaction",
  "title",
  "summary",
]);

/**
 * How one provider receives routing. Only listed providers are routed;
 * anything else keeps its configured model behavior.
 */
export interface ProviderRule {
  /**
   * providerOptions key receiving the resolved effort. Keys are
   * protocol-semantic (e.g. OpenAI Responses uses `reasoningEffort`); only
   * configure a key verified against the provider's protocol.
   */
  option: string;
  /** Efforts this provider accepts; always intersected with the agent range. */
  efforts: ReasoningEffort[];
}

/** Verified default: OpenAI Responses `reasoningEffort` accepts the ladder. */
export const DEFAULT_REASONING_OPTION = "reasoningEffort";

export const DEFAULT_PROVIDER_RULES: Readonly<Record<string, ProviderRule>> = {
  openai: { option: DEFAULT_REASONING_OPTION, efforts: [...EFFORTS] },
};

export function isEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === "string" &&
    (EFFORTS as readonly string[]).includes(value)
  );
}

export function isReasoningClass(value: unknown): value is ReasoningClass {
  return (
    typeof value === "string" &&
    (REASONING_CLASSES as readonly string[]).includes(value)
  );
}

function effortIndex(effort: ReasoningEffort): number {
  return EFFORTS.indexOf(effort);
}

export interface ResolveInput {
  agent: string;
  /** Raw requested class; invalid values fall back to `auto`. */
  requested?: unknown;
  /** Escalate one level (repeated failures, contradictions, migrations, ...). */
  escalate?: boolean;
  /**
   * Efforts the selected model supports. Defaults to the full ladder (no
   * model cap). Unknown strings are ignored; an empty result means no
   * override can be applied.
   */
  supported?: readonly unknown[];
  policy?: Readonly<Record<string, AgentPolicy>>;
  classBase?: Readonly<
    Record<Exclude<ReasoningClass, "auto">, ReasoningEffort>
  >;
}

export interface ResolveResult {
  /** Resolved effort, or `undefined` when no override should be applied. */
  effort: ReasoningEffort | undefined;
  /** Normalized requested class. */
  requested: ReasoningClass;
  /** Short audit trail of the matched rule (no prompt content). */
  rule: string;
  /** Present when input was invalid or an override was impossible. */
  fallback?: string;
}

/**
 * Map a semantic class to a concrete effort, clamped to the agent range
 * and the model's supported efforts. Pure and total.
 */
export function resolveReasoningEffort(input: ResolveInput): ResolveResult {
  const policy = input.policy ?? DEFAULT_AGENT_POLICY;
  const classBase = input.classBase ?? CLASS_BASE_EFFORT;
  const agentPolicy = policy[input.agent];
  if (!agentPolicy) {
    return {
      effort: undefined,
      requested: "auto",
      rule: `agent=${input.agent} passthrough`,
      fallback: `unknown agent '${input.agent}': no routing policy, model default kept`,
    };
  }

  let requested: ReasoningClass = "auto";
  let fallback: string | undefined;
  if (input.requested === undefined) {
    requested = "auto";
  } else if (isReasoningClass(input.requested)) {
    requested = input.requested;
  } else {
    fallback = `invalid class '${String(input.requested)}': fell back to auto`;
  }

  const notes: string[] = [];
  if (fallback) notes.push(fallback);

  let effort: ReasoningEffort =
    requested === "auto" ? agentPolicy.def : classBase[requested];

  if (effortIndex(effort) < effortIndex(agentPolicy.min)) {
    notes.push(`clamped to agent minimum (${agentPolicy.min})`);
    effort = agentPolicy.min;
  } else if (effortIndex(effort) > effortIndex(agentPolicy.max)) {
    notes.push(`clamped to agent maximum (${agentPolicy.max})`);
    effort = agentPolicy.max;
  }

  if (input.escalate) {
    const escalated = EFFORTS[Math.min(effortIndex(effort) + 1, EFFORTS.length - 1)];
    if (effortIndex(escalated) > effortIndex(agentPolicy.max)) {
      notes.push(`escalation capped at agent maximum (${agentPolicy.max})`);
    } else if (escalated !== effort) {
      notes.push("escalated one level");
      effort = escalated;
    }
  }

  const supported = (input.supported ?? [...EFFORTS]).filter(isEffort);
  // Caps are invariant: only efforts inside the agent range are eligible.
  const inRange = (candidate: ReasoningEffort): boolean =>
    effortIndex(candidate) >= effortIndex(agentPolicy.min) &&
    effortIndex(candidate) <= effortIndex(agentPolicy.max);
  const candidates = supported.filter(inRange);
  if (candidates.length === 0) {
    return {
      effort: undefined,
      requested,
      rule:
        `agent=${input.agent} class=${requested} base=${effort} ` +
        `range=${agentPolicy.min}-${agentPolicy.max} no-supported-effort-in-range`,
      fallback: [
        ...notes,
        "no model-supported effort within the agent range: model default kept",
      ].join("; "),
    };
  }
  if (!candidates.includes(effort)) {
    const below = [...candidates]
      .filter((candidate) => effortIndex(candidate) <= effortIndex(effort))
      .sort((a, b) => effortIndex(b) - effortIndex(a));
    const above = [...candidates].sort((a, b) => effortIndex(a) - effortIndex(b));
    const replacement = below[0] ?? above[0];
    if (!replacement) {
      return {
        effort: undefined,
        requested,
        rule: `agent=${input.agent} class=${requested} no-supported-effort-in-range`,
        fallback: [...notes, "no model-supported effort within the agent range: model default kept"].join("; "),
      };
    }
    notes.push(`model lacks '${effort}': nearest supported in range ('${replacement}')`);
    effort = replacement;
  }

  const rule =
    `agent=${input.agent} class=${requested}${input.escalate ? "+escalate" : ""} ` +
    `base=${requested === "auto" ? agentPolicy.def : classBase[requested as Exclude<ReasoningClass, "auto">]} ` +
    `range=${agentPolicy.min}-${agentPolicy.max} -> ${effort}`;
  return {
    effort,
    requested,
    rule,
    ...(notes.length > 0 ? { fallback: notes.join("; ") } : {}),
  };
}

/** Prompt marker: `[reasoning:deep]`, `[reasoning:fast:escalate]`, ... */
const MARKER_RE = /\[reasoning\s*:\s*(auto|fast|balanced|deep)(\s*(?::|\+)\s*escalate)?\s*\]/i;

export interface ParsedMarker {
  requested: ReasoningClass;
  escalate: boolean;
}

/** First marker wins. Returns `undefined` when no marker is present. */
export function parseReasoningMarker(text: string): ParsedMarker | undefined {
  const match = MARKER_RE.exec(text);
  if (!match) return undefined;
  return {
    requested: match[1].toLowerCase() as ReasoningClass,
    escalate: Boolean(match[2]),
  };
}

/** Global (non-first-match) variant of the marker pattern for stripping. */
const MARKER_STRIP_RE = new RegExp(MARKER_RE.source, "gi");

/**
 * Remove routing markers from a message-graph value in place (event drafts
 * are owned-mutable). Cycles are safe. Returns the replacement count.
 */
export function stripReasoningMarkers(value: unknown): number {
  let count = 0;
  const seen = new Set<object>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") return;
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        if (typeof item === "string") {
          const stripped = item.replace(MARKER_STRIP_RE, "");
          if (stripped !== item) {
            node[i] = stripped;
            count++;
          }
        } else {
          visit(item);
        }
      }
      return;
    }
    for (const [key, item] of Object.entries(node)) {
      if (typeof item === "string") {
        const stripped = item.replace(MARKER_STRIP_RE, "");
        if (stripped !== item) {
          (node as Record<string, unknown>)[key] = stripped;
          count++;
        }
      } else {
        visit(item);
      }
    }
  };
  visit(value);
  return count;
}

export interface RouterOptions {
  /** Max diagnostics entries kept in memory. Default 100. */
  diagnosticsLimit: number;
  /** Per-agent policy overrides. Merged over {@link DEFAULT_AGENT_POLICY}. */
  agentPolicy: Record<string, AgentPolicy>;
  /** Base-effort overrides for explicit classes. */
  classBase: Record<Exclude<ReasoningClass, "auto">, ReasoningEffort>;
  /**
   * Default effort ladder for provider entries that omit `efforts`. There is
   * no authoritative per-model capability feed, so this defaults to the full
   * ladder; narrow it if a model rejects an effort. Empty disables overrides.
   */
  supportedEfforts: ReasoningEffort[];
  /**
   * Per-provider routing rules. Only listed providers are routed (default:
   * `openai` only). The hook is registered once per listed provider.
   */
  providers: Record<string, ProviderRule>;
}

const KNOWN_OPTION_KEYS = new Set([
  "diagnosticsLimit",
  "agentPolicy",
  "classBase",
  "supportedEfforts",
  "providers",
]);

const KNOWN_PROVIDER_KEYS = new Set(["option", "efforts"]);

/** Routing rule for a provider, or `undefined` when it must stay untouched. */
export function providerRuleFor(
  options: RouterOptions,
  providerID: string | undefined,
): ProviderRule | undefined {
  if (!providerID) return undefined;
  return options.providers[providerID];
}

function assertAgentPolicy(agent: string, value: unknown): AgentPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`reasoning-router: options.agentPolicy['${agent}'] must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of ["def", "min", "max"] as const) {
    if (!isEffort(record[key])) {
      throw new Error(
        `reasoning-router: options.agentPolicy['${agent}'].${key} must be one of ${EFFORTS.join(", ")}`,
      );
    }
  }
  const policy = record as unknown as AgentPolicy;
  if (effortIndex(policy.min) > effortIndex(policy.max)) {
    throw new Error(
      `reasoning-router: options.agentPolicy['${agent}'].min must not exceed max`,
    );
  }
  if (
    effortIndex(policy.def) < effortIndex(policy.min) ||
    effortIndex(policy.def) > effortIndex(policy.max)
  ) {
    throw new Error(
      `reasoning-router: options.agentPolicy['${agent}'].def must be within min..max`,
    );
  }
  return { def: policy.def, min: policy.min, max: policy.max };
}

/** Validate raw plugin options. Throws on invalid config (fail fast). */
export function validateOptions(raw: unknown): RouterOptions {
  const source =
    raw === undefined || raw === null
      ? {}
      : (raw as Record<string, unknown>);
  if (typeof source !== "object" || Array.isArray(source)) {
    throw new Error("reasoning-router: options must be an object");
  }
  for (const key of Object.keys(source)) {
    if (!KNOWN_OPTION_KEYS.has(key)) {
      throw new Error(
        `reasoning-router: unknown option '${key}' (expected ${[...KNOWN_OPTION_KEYS].join(", ")})`,
      );
    }
  }

  const diagnosticsLimit = source.diagnosticsLimit ?? 100;
  if (
    typeof diagnosticsLimit !== "number" ||
    !Number.isInteger(diagnosticsLimit) ||
    diagnosticsLimit < 1 ||
    diagnosticsLimit > 1000
  ) {
    throw new Error(
      "reasoning-router: options.diagnosticsLimit must be an integer 1..1000",
    );
  }

  const agentPolicy: Record<string, AgentPolicy> = { ...DEFAULT_AGENT_POLICY };
  const rawPolicy = source.agentPolicy ?? {};
  if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
    throw new Error("reasoning-router: options.agentPolicy must be an object");
  }
  for (const [agent, override] of Object.entries(rawPolicy)) {
    agentPolicy[agent] = assertAgentPolicy(agent, override);
  }

  const classBase: RouterOptions["classBase"] = { ...CLASS_BASE_EFFORT };
  const rawBase = source.classBase ?? {};
  if (!rawBase || typeof rawBase !== "object" || Array.isArray(rawBase)) {
    throw new Error("reasoning-router: options.classBase must be an object");
  }
  for (const [name, effort] of Object.entries(rawBase)) {
    if (name === "auto") {
      throw new Error("reasoning-router: options.classBase must not override 'auto'");
    }
    if (!isReasoningClass(name) || name === "auto") {
      throw new Error(
        `reasoning-router: options.classBase key '${name}' must be one of fast, balanced, deep`,
      );
    }
    if (!isEffort(effort)) {
      throw new Error(
        `reasoning-router: options.classBase['${name}'] must be one of ${EFFORTS.join(", ")}`,
      );
    }
    classBase[name] = effort;
  }

  const rawSupported = source.supportedEfforts ?? [...EFFORTS];
  if (!Array.isArray(rawSupported)) {
    throw new Error("reasoning-router: options.supportedEfforts must be an array");
  }
  const supportedEfforts: ReasoningEffort[] = [];
  for (const entry of rawSupported) {
    if (!isEffort(entry)) {
      throw new Error(
        `reasoning-router: options.supportedEfforts entry '${String(entry)}' must be one of ${EFFORTS.join(", ")}`,
      );
    }
    if (!supportedEfforts.includes(entry)) supportedEfforts.push(entry);
  }

  const rawProviders = source.providers ?? { openai: {} };
  if (!rawProviders || typeof rawProviders !== "object" || Array.isArray(rawProviders)) {
    throw new Error("reasoning-router: options.providers must be an object");
  }
  const providers: Record<string, ProviderRule> = {};
  for (const [providerID, entry] of Object.entries(rawProviders)) {
    const record =
      entry === undefined || entry === null
        ? {}
        : (entry as Record<string, unknown>);
    if (typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`reasoning-router: options.providers['${providerID}'] must be an object`);
    }
    for (const key of Object.keys(record)) {
      if (!KNOWN_PROVIDER_KEYS.has(key)) {
        throw new Error(
          `reasoning-router: unknown providers['${providerID}'] key '${key}' (expected ${[...KNOWN_PROVIDER_KEYS].join(", ")})`,
        );
      }
    }
    const option = record.option ?? DEFAULT_REASONING_OPTION;
    if (typeof option !== "string" || option.length === 0) {
      throw new Error(
        `reasoning-router: options.providers['${providerID}'].option must be a non-empty string`,
      );
    }
    const rawEfforts = record.efforts ?? supportedEfforts;
    if (!Array.isArray(rawEfforts) || rawEfforts.length === 0) {
      throw new Error(
        `reasoning-router: options.providers['${providerID}'].efforts must be a non-empty array`,
      );
    }
    const efforts: ReasoningEffort[] = [];
    for (const effortEntry of rawEfforts) {
      if (!isEffort(effortEntry)) {
        throw new Error(
          `reasoning-router: options.providers['${providerID}'].efforts entry '${String(effortEntry)}' must be one of ${EFFORTS.join(", ")}`,
        );
      }
      if (!efforts.includes(effortEntry)) efforts.push(effortEntry);
    }
    providers[providerID] = { option, efforts };
  }

  return { diagnosticsLimit, agentPolicy, classBase, supportedEfforts, providers };
}

/** Collect marker-relevant text from a message graph without retaining it. */
export function collectMessageText(messages: unknown, budget = 20000): string {
  const chunks: string[] = [];
  let size = 0;
  const seen = new Set<object>();
  const visit = (node: unknown): void => {
    if (size >= budget) return;
    if (typeof node === "string") {
      if (node.length > 0 && MARKER_RE.test(node)) {
        chunks.push(node);
        size += node.length;
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const item of Object.values(node)) visit(item);
  };
  visit(messages);
  return chunks.join("\n");
}

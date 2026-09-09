/**
 * Pure quota-failover policy for the quota-fallback plugin (V2-only).
 *
 * No OpenCode imports: deterministic, side-effect free, unit-tested.
 * The plugin hook in `./index.ts` owns session state and OpenCode wiring.
 */

export interface ModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

/** One ordered fallback preference. First match wins. */
export interface FallbackEntry {
  /** Agents this entry applies to; omitted = all agents. */
  agents?: string[];
  model: ModelRef;
}

export interface QuotaOptions {
  /** Master switch. When false the hook observes nothing and changes nothing. */
  enabled: boolean;
  /** Delay (ms) for the retry scheduled after a successful switch. */
  retryDelayMs: number;
  /** Max model switches per session (circuit breaker). */
  maxSwitchesPerSession: number;
  /** Ordered fallback preferences. */
  fallbacks: FallbackEntry[];
}

export interface ProviderError {
  type?: unknown;
  message?: unknown;
  status?: unknown;
}

/** Proven-working free fallback for this workspace. */
export const DEFAULT_FALLBACK_MODEL: ModelRef = {
  providerID: "opencode",
  id: "muse-spark-1.3-contributor-free",
};

const QUOTA_TYPE_RE = /rate[-_. ]?limit|quota|capacity|insufficient|too[-_. ]?many[-_. ]?requests/;
const QUOTA_MESSAGE_RE =
  /quota|rate.?limit|too many requests|\b429\b|insufficient|usage limit|overloaded|capacity|billing|credit|exhausted/;

/**
 * Heuristic quota/rate-limit classifier. Tight by design: only 429-class
 * signals match, so auth, validation, and server errors never trigger a
 * model switch (which would mask the real failure).
 */
export function isQuotaError(error: ProviderError): boolean {
  if (typeof error.status === "number" && error.status === 429) return true;
  if (typeof error.type === "string" && QUOTA_TYPE_RE.test(error.type.toLowerCase())) {
    return true;
  }
  if (typeof error.message === "string" && QUOTA_MESSAGE_RE.test(error.message.toLowerCase())) {
    return true;
  }
  return false;
}

export function modelKey(model: { providerID?: unknown; id?: unknown }): string {
  return `${typeof model.providerID === "string" ? model.providerID : "?"}:${typeof model.id === "string" ? model.id : "?"}`;
}

/**
 * First fallback entry matching the agent whose model is not excluded
 * (already failed or already active). Returns `undefined` when none applies.
 */
export function selectFallback(
  options: QuotaOptions,
  agent: string,
  exclude: ReadonlySet<string>,
): ModelRef | undefined {
  for (const entry of options.fallbacks) {
    if (entry.agents && !entry.agents.includes(agent)) continue;
    if (exclude.has(modelKey(entry.model))) continue;
    return entry.model;
  }
  return undefined;
}

const KNOWN_OPTION_KEYS = new Set([
  "enabled",
  "retryDelayMs",
  "maxSwitchesPerSession",
  "fallbacks",
]);
const KNOWN_ENTRY_KEYS = new Set(["agents", "model"]);
const KNOWN_MODEL_KEYS = new Set(["providerID", "id", "variant"]);

const MODEL_REF_RE = /^([^/\s#]+)\/([^#\s]+?)(?:#(\S+))?$/;

/**
 * Parse `provider/model[#variant]` (the same syntax as agent `model:`).
 * Throws a descriptive error on invalid input.
 */
export function parseModelRef(value: unknown): ModelRef {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      "quota-fallback: fallback model must be a string like 'provider/model#variant'",
    );
  }
  const match = MODEL_REF_RE.exec(value.trim());
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `quota-fallback: invalid model reference '${value}' (expected 'provider/model[#variant]')`,
    );
  }
  const model: ModelRef = { providerID: match[1], id: match[2] };
  if (match[3]) model.variant = match[3];
  return model;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
const FALLBACK_DIRECTIVE_RE = /^\s*#\s*fallback-model\s*:\s*(.+?)\s*$/im;

/**
 * Read the per-agent fallback directive from raw agent-file text. Only the
 * commented form (`# fallback-model: ...`) inside frontmatter is honored: a
 * bare key would leak into OpenCode request bodies, so it is ignored here.
 * First match wins; quotes are stripped.
 */
export function extractAgentFallbackModel(fileText: unknown): string | undefined {
  if (typeof fileText !== "string") return undefined;
  const frontmatter = FRONTMATTER_RE.exec(fileText);
  const scope = frontmatter?.[1] ?? fileText;
  const line = FALLBACK_DIRECTIVE_RE.exec(scope);
  const raw = line?.[1]?.trim().replace(/^["']|["']$/g, "");
  return raw && raw.length > 0 ? raw : undefined;
}

function assertModelRef(value: unknown, where: string): ModelRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`quota-fallback: ${where}.model must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_MODEL_KEYS.has(key)) {
      throw new Error(
        `quota-fallback: unknown ${where}.model key '${key}' (expected ${[...KNOWN_MODEL_KEYS].join(", ")})`,
      );
    }
  }
  if (typeof record.providerID !== "string" || record.providerID.length === 0) {
    throw new Error(`quota-fallback: ${where}.model.providerID must be a non-empty string`);
  }
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new Error(`quota-fallback: ${where}.model.id must be a non-empty string`);
  }
  if (record.variant !== undefined && (typeof record.variant !== "string" || record.variant.length === 0)) {
    throw new Error(`quota-fallback: ${where}.model.variant must be a non-empty string when set`);
  }
  const model: ModelRef = { providerID: record.providerID, id: record.id };
  if (typeof record.variant === "string") model.variant = record.variant;
  return model;
}

/** Validate raw plugin options. Throws on invalid config (fail fast). */
export function validateQuotaOptions(raw: unknown): QuotaOptions {
  const source =
    raw === undefined || raw === null ? {} : (raw as Record<string, unknown>);
  if (typeof source !== "object" || Array.isArray(source)) {
    throw new Error("quota-fallback: options must be an object");
  }
  for (const key of Object.keys(source)) {
    if (!KNOWN_OPTION_KEYS.has(key)) {
      throw new Error(
        `quota-fallback: unknown option '${key}' (expected ${[...KNOWN_OPTION_KEYS].join(", ")})`,
      );
    }
  }

  const enabled = source.enabled ?? true;
  if (typeof enabled !== "boolean") {
    throw new Error("quota-fallback: options.enabled must be a boolean");
  }

  const retryDelayMs = source.retryDelayMs ?? 2000;
  if (
    typeof retryDelayMs !== "number" ||
    !Number.isInteger(retryDelayMs) ||
    retryDelayMs < 0 ||
    retryDelayMs > 120000
  ) {
    throw new Error(
      "quota-fallback: options.retryDelayMs must be an integer 0..120000",
    );
  }

  const maxSwitchesPerSession = source.maxSwitchesPerSession ?? 1;
  if (
    typeof maxSwitchesPerSession !== "number" ||
    !Number.isInteger(maxSwitchesPerSession) ||
    maxSwitchesPerSession < 0 ||
    maxSwitchesPerSession > 5
  ) {
    throw new Error(
      "quota-fallback: options.maxSwitchesPerSession must be an integer 0..5",
    );
  }

  const rawFallbacks = source.fallbacks ?? [{ model: { ...DEFAULT_FALLBACK_MODEL } }];
  if (!Array.isArray(rawFallbacks)) {
    throw new Error("quota-fallback: options.fallbacks must be an array");
  }
  if (enabled && rawFallbacks.length === 0) {
    throw new Error("quota-fallback: options.fallbacks must not be empty when enabled");
  }
  const fallbacks: FallbackEntry[] = [];
  rawFallbacks.forEach((entry, index) => {
    const where = `options.fallbacks[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`quota-fallback: ${where} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!KNOWN_ENTRY_KEYS.has(key)) {
        throw new Error(
          `quota-fallback: unknown ${where} key '${key}' (expected ${[...KNOWN_ENTRY_KEYS].join(", ")})`,
        );
      }
    }
    let agents: string[] | undefined;
    if (record.agents !== undefined) {
      if (!Array.isArray(record.agents) || record.agents.length === 0) {
        throw new Error(`quota-fallback: ${where}.agents must be a non-empty array when set`);
      }
      agents = [];
      for (const agent of record.agents) {
        if (typeof agent !== "string" || agent.length === 0) {
          throw new Error(`quota-fallback: ${where}.agents entries must be non-empty strings`);
        }
        if (!agents.includes(agent)) agents.push(agent);
      }
    }
    const model = assertModelRef(record.model, where);
    fallbacks.push(agents ? { agents, model } : { model });
  });

  return { enabled, retryDelayMs, maxSwitchesPerSession, fallbacks };
}

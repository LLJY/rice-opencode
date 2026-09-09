/**
 * Pure policy for the openai-long-context plugin (V2-only).
 *
 * No OpenCode imports here: this module is deterministic, side-effect free,
 * and covered by unit tests. The catalog transform in `./index.ts` owns
 * OpenCode wiring.
 *
 * The plugin clones every `<prefix>*` model on the configured provider into
 * a `<id><suffix>` variant with a 1M-token context window. The V1 sketch this
 * ports gated on OAuth auth (`ctx.auth?.type === "oauth"`); V2 catalog
 * transforms carry no auth context, so variants are registered unconditionally
 * and inert until selected. API-key callers simply ignore the extra entries.
 */

export const DEFAULT_PROVIDER_ID = "openai";
export const DEFAULT_MODEL_PREFIX = "gpt-5.6-";
export const DEFAULT_SUFFIX = "-1m";
export const DEFAULT_NAME_SUFFIX = " (1M context)";

export const DEFAULT_LIMIT = {
  context: 1_000_000,
  input: 872_000,
  output: 128_000,
} as const;

export interface ModelLimit {
  context: number;
  input: number;
  output: number;
}

export interface LongContextOptions {
  /** Master switch. When false the transform registers nothing. */
  enabled: boolean;
  /** Provider whose catalog is scanned (default: `openai`). */
  providerID: string;
  /** Only model IDs starting with this prefix are cloned. */
  modelPrefix: string;
  /** Appended to the base ID for the long-context variant. */
  suffix: string;
  /** Appended to the base display name. */
  nameSuffix: string;
  /** Token limits applied to every long-context variant. */
  limit: ModelLimit;
}

/** Minimal structural view of a catalog model the policy reads. */
export interface CatalogModelLike {
  id: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  [key: string]: unknown;
}

/** Minimal structural view of the V2 catalog editor the policy needs. */
export interface CatalogEditorLike {
  provider: {
    get(
      providerID: string,
    ):
      | {
          provider: unknown;
          models: ReadonlyMap<string, CatalogModelLike>;
        }
      | undefined;
  };
  model: {
    update(
      providerID: string,
      modelID: string,
      update: (model: Record<string, unknown>) => void,
    ): void;
  };
}

const KNOWN_OPTION_KEYS = new Set([
  "enabled",
  "providerID",
  "modelPrefix",
  "suffix",
  "nameSuffix",
  "limit",
]);
const KNOWN_LIMIT_KEYS = new Set(["context", "input", "output"]);

/** True when the ID is a base model eligible for 1M cloning. */
export function isEligibleModelId(
  id: unknown,
  modelPrefix: string = DEFAULT_MODEL_PREFIX,
  suffix: string = DEFAULT_SUFFIX,
): id is string {
  return (
    typeof id === "string" &&
    id.startsWith(modelPrefix) &&
    !id.endsWith(suffix)
  );
}

/** Long-context variant ID for a base model ID. */
export function longModelId(
  baseId: string,
  suffix: string = DEFAULT_SUFFIX,
): string {
  return `${baseId}${suffix}`;
}

/** Display name for a long-context variant. */
export function longModelName(
  baseName: string,
  nameSuffix: string = DEFAULT_NAME_SUFFIX,
): string {
  return `${baseName}${nameSuffix}`;
}

/**
 * Base IDs eligible for cloning, in catalog iteration order. Pure helper
 * for logging and tests; the transform itself re-derives this.
 */
export function collectTargets(
  models: Iterable<CatalogModelLike>,
  modelPrefix: string = DEFAULT_MODEL_PREFIX,
  suffix: string = DEFAULT_SUFFIX,
): string[] {
  const targets: string[] = [];
  for (const model of models) {
    if (isEligibleModelId(model?.id, modelPrefix, suffix)) {
      targets.push(model.id);
    }
  }
  return targets;
}

function assertNonEmptyString(
  value: unknown,
  where: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `openai-long-context: options.${where} must be a non-empty string`,
    );
  }
  return value;
}

function validateLimit(raw: unknown): ModelLimit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("openai-long-context: options.limit must be an object");
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_LIMIT_KEYS.has(key)) {
      throw new Error(
        `openai-long-context: unknown options.limit key '${key}' (expected ${[...KNOWN_LIMIT_KEYS].join(", ")})`,
      );
    }
  }
  for (const key of ["context", "input", "output"] as const) {
    const value = record[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value <= 0
    ) {
      throw new Error(
        `openai-long-context: options.limit.${key} must be a positive integer`,
      );
    }
  }
  const limit = record as unknown as ModelLimit;
  if (limit.input > limit.context) {
    throw new Error(
      "openai-long-context: options.limit.input must not exceed options.limit.context",
    );
  }
  if (limit.output > limit.context) {
    throw new Error(
      "openai-long-context: options.limit.output must not exceed options.limit.context",
    );
  }
  return { context: limit.context, input: limit.input, output: limit.output };
}

/** Validate raw plugin options. Throws on invalid config (fail fast). */
export function validateOptions(raw: unknown): LongContextOptions {
  const source =
    raw === undefined || raw === null ? {} : (raw as Record<string, unknown>);
  if (typeof source !== "object" || Array.isArray(source)) {
    throw new Error("openai-long-context: options must be an object");
  }
  for (const key of Object.keys(source)) {
    if (!KNOWN_OPTION_KEYS.has(key)) {
      throw new Error(
        `openai-long-context: unknown option '${key}' (expected ${[...KNOWN_OPTION_KEYS].join(", ")})`,
      );
    }
  }

  const enabled = source.enabled ?? true;
  if (typeof enabled !== "boolean") {
    throw new Error("openai-long-context: options.enabled must be a boolean");
  }

  const providerID =
    source.providerID === undefined
      ? DEFAULT_PROVIDER_ID
      : assertNonEmptyString(source.providerID, "providerID");
  const modelPrefix =
    source.modelPrefix === undefined
      ? DEFAULT_MODEL_PREFIX
      : assertNonEmptyString(source.modelPrefix, "modelPrefix");
  const suffix =
    source.suffix === undefined
      ? DEFAULT_SUFFIX
      : assertNonEmptyString(source.suffix, "suffix");
  const nameSuffix =
    source.nameSuffix === undefined
      ? DEFAULT_NAME_SUFFIX
      : assertNonEmptyString(source.nameSuffix, "nameSuffix");
  const limit =
    source.limit === undefined
      ? { ...DEFAULT_LIMIT }
      : validateLimit(source.limit);

  return { enabled, providerID, modelPrefix, suffix, nameSuffix, limit };
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Register `<base><suffix>` 1M variants for every eligible base model on the
 * configured provider. Idempotent: replays derive the same set from the same
 * base models, and existing long variants are refreshed in place.
 *
 * Never throws for missing providers or empty catalogs (registers nothing).
 * Returns the created variant IDs in catalog order for logging.
 */
export function applyLongContextModels(
  editor: CatalogEditorLike,
  options: LongContextOptions,
): string[] {
  if (!options.enabled) return [];
  const record = editor.provider.get(options.providerID);
  if (!record) return [];

  const bases = [...record.models.values()].filter((model) =>
    isEligibleModelId(model?.id, options.modelPrefix, options.suffix),
  );
  const created: string[] = [];

  for (const base of bases) {
    const variantId = longModelId(base.id, options.suffix);
    // Upstream ID follows any existing alias (e.g. a `-fast` base already
    // resolves to its non-fast ID); mirrors V1's `api.id` behavior.
    const upstreamId =
      typeof base.modelID === "string" && base.modelID.length > 0
        ? base.modelID
        : base.id;
    const baseName =
      typeof base.name === "string" && base.name.length > 0
        ? base.name
        : base.id;
    const variantName = longModelName(baseName, options.nameSuffix);
    const limit = { ...options.limit };

    // Snapshot everything except identity/name/limit so the variant inherits
    // capabilities, cost, compatibility, variants, and transport settings.
    const inherited: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(base)) {
      if (key === "id" || key === "modelID" || key === "name" || key === "limit") {
        continue;
      }
      inherited[key] = cloneValue(value);
    }

    editor.model.update(options.providerID, variantId, (model) => {
      for (const [key, value] of Object.entries(inherited)) {
        model[key] = value;
      }
      model.id = variantId;
      // Upstream alias: the Codex backend only knows the base model ID
      // (mirrors V1's `api.id`; cf. `-fast` variants, which resolve to the
      // non-fast ID upstream). The catalog key stays `-1m` so both remain
      // selectable; only the wire ID is the base model.
      model.modelID = upstreamId;
      model.providerID = options.providerID;
      model.name = variantName;
      model.limit = { ...limit };
    });
    created.push(variantId);
  }

  return created;
}

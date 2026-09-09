/**
 * Pure policy + estimation helpers for the token-saver plugin (V2-only).
 *
 * No OpenCode imports here: deterministic, side-effect free, unit tested.
 * The plugin hook in `./index.ts` owns session state and OpenCode wiring.
 */

/** Characters per token for the chars/4 heuristic. */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return estimateTokensForLength(text ? text.length : 0);
}

/** Length-based estimate that avoids allocating padding strings. */
export function estimateTokensForLength(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

/** Safely stringify an unknown tool input/result for sizing. Never throws. */
export function sizableText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : "";
  } catch {
    return "";
  }
}

export interface PatternToggles {
  /** Per-tool call counting + token estimates + status tool. */
  meter: boolean;
  /** Description compression + read-output compaction. */
  slimmer: boolean;
  /** Context-hook pruning of obsolete tool outputs. */
  pruner: boolean;
}

export interface TokenSaverOptions {
  diagnosticsLimit: number;
  patterns: PatternToggles;
  /** Max chars kept per tool result before compaction truncates. */
  maxResultChars: number;
}

const DEFAULTS: TokenSaverOptions = {
  diagnosticsLimit: 100,
  patterns: { meter: true, slimmer: false, pruner: false },
  maxResultChars: 12_000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 1) throw new Error(`[token-saver] option must be >= 1, got ${value}`);
  if (n > max) throw new Error(`[token-saver] option must be <= ${max}, got ${value}`);
  return n;
}

/**
 * Validate raw plugin options. Invalid options throw at setup so
 * misconfiguration is visible instead of silently ignored.
 */
export function validateOptions(rawOptions?: unknown): TokenSaverOptions {
  if (rawOptions === undefined || rawOptions === null) return { ...DEFAULTS, patterns: { ...DEFAULTS.patterns } };
  if (!isRecord(rawOptions)) throw new Error("[token-saver] options must be an object");
  const patterns = isRecord(rawOptions.patterns) ? rawOptions.patterns : {};
  return {
    diagnosticsLimit: toPositiveInt(rawOptions.diagnosticsLimit, DEFAULTS.diagnosticsLimit, 1000),
    patterns: {
      meter: toBool(patterns.meter, DEFAULTS.patterns.meter),
      slimmer: toBool(patterns.slimmer, DEFAULTS.patterns.slimmer),
      pruner: toBool(patterns.pruner, DEFAULTS.patterns.pruner),
    },
    maxResultChars: toPositiveInt(rawOptions.maxResultChars, DEFAULTS.maxResultChars, 1_000_000),
  };
}

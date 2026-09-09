/**
 * Pure policy + payload helpers for the notify plugin (V2-only).
 *
 * No OpenCode imports here: deterministic, side-effect free, unit tested.
 * The plugin in `./index.ts` owns the event loop and network calls.
 */

/** V2 execution events we notify on (verified in client api.d.ts). */
export const SUPPORTED_EVENTS = ["session.execution.succeeded", "session.execution.failed"] as const;
export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];

export function isSupportedEvent(type: unknown): type is SupportedEvent {
  return typeof type === "string" && (SUPPORTED_EVENTS as readonly string[]).includes(type);
}

export interface NotifyEvents {
  succeeded: boolean;
  failed: boolean;
}

export interface NotifyOptions {
  enabled: boolean;
  /** ntfy server base URL. Empty topic disables delivery with a warning. */
  server: string;
  topic: string;
  token: string;
  events: NotifyEvents;
  timeoutMs: number;
}

const DEFAULTS: NotifyOptions = {
  enabled: true,
  server: "https://ntfy.sh",
  topic: "",
  token: "",
  events: { succeeded: true, failed: true },
  timeoutMs: 8000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function toTimeout(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 1000 || n > 60_000) throw new Error(`[notify] timeoutMs must be 1000..60000, got ${value}`);
  return n;
}

function normalizeServer(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) throw new Error(`[notify] server must be an http(s) URL, got ${server}`);
  return trimmed;
}

/**
 * Validate raw plugin options. Invalid options throw at setup so
 * misconfiguration is visible instead of silently ignored. An empty topic
 * does NOT throw — delivery stays disabled with a warning (a notifier must
 * never break sessions over missing configuration).
 */
export function validateOptions(rawOptions?: unknown): NotifyOptions {
  if (rawOptions === undefined || rawOptions === null) {
    return { ...DEFAULTS, events: { ...DEFAULTS.events } };
  }
  if (!isRecord(rawOptions)) throw new Error("[notify] options must be an object");
  const events = isRecord(rawOptions.events) ? rawOptions.events : {};
  const server = normalizeServer(toText(rawOptions.server, DEFAULTS.server));
  return {
    enabled: toBool(rawOptions.enabled, DEFAULTS.enabled),
    server,
    topic: toText(rawOptions.topic, DEFAULTS.topic).trim(),
    token: toText(rawOptions.token, DEFAULTS.token),
    events: {
      succeeded: toBool(events.succeeded, DEFAULTS.events.succeeded),
      failed: toBool(events.failed, DEFAULTS.events.failed),
    },
    timeoutMs: toTimeout(rawOptions.timeoutMs, DEFAULTS.timeoutMs),
  };
}

export interface Notification {
  title: string;
  message: string;
  tags: string;
  priority: number;
}

/** Map a V2 execution event to an ntfy notification. Pure; no network. */
export function toNotification(type: SupportedEvent, sessionID: string, errorMessage?: string): Notification | null {
  if (type === "session.execution.succeeded") {
    return {
      title: "opencode: execution succeeded",
      message: `Session ${sessionID} finished and is waiting for input.`,
      tags: "hourglass_done",
      priority: 3,
    };
  }
  if (type === "session.execution.failed") {
    return {
      title: "opencode: execution failed",
      message: `Session ${sessionID} failed${errorMessage ? `: ${errorMessage}` : "."}`,
      tags: "warning",
      priority: 4,
    };
  }
  return null;
}

/** Decide whether an event type passes the configured event filter. */
export function passesFilter(type: SupportedEvent, events: NotifyEvents): boolean {
  if (type === "session.execution.succeeded") return events.succeeded;
  if (type === "session.execution.failed") return events.failed;
  return false;
}

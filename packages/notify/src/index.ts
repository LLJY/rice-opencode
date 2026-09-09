/**
 * notify — V2-only OpenCode plugin.
 *
 * Subscribes to V2 session execution events and POSTs ntfy push
 * notifications. Event-driven: no tools added, no prompts injected, zero
 * context cost. Every failure path logs a warning and continues — a
 * notifier must never break sessions.
 *
 * V2 limitation (verified in client api.d.ts): there is no permission event,
 * so permission-asked notifications are unsupported until the API exposes one.
 */

import { Plugin } from "@opencode-ai/plugin";
import {
  isSupportedEvent,
  passesFilter,
  toNotification,
  validateOptions,
  type NotifyOptions,
} from "./policy";

export const PLUGIN_ID = "notify";

export interface NotifyState {
  options: NotifyOptions;
}

export function createNotifyState(rawOptions?: unknown): NotifyState {
  return { options: validateOptions(rawOptions) };
}

interface EventLike {
  readonly type?: unknown;
  readonly data?: unknown;
}

function eventData(event: EventLike): { sessionID?: string; errorMessage?: string } {
  const data = event.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const record = data as Record<string, unknown>;
  const sessionID = typeof record.sessionID === "string" ? record.sessionID : undefined;
  const error = record.error;
  let errorMessage: string | undefined;
  if (typeof error === "object" && error !== null && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") errorMessage = message.slice(0, 500);
  }
  return { sessionID, errorMessage };
}

async function postNtfy(options: NotifyOptions, title: string, message: string, tags: string, priority: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const headers: Record<string, string> = {
      Title: title,
      Tags: tags,
      Priority: String(priority),
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(`${options.server}/${options.topic}`, {
      method: "POST",
      headers,
      body: message,
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[notify] ntfy POST failed: ${response.status} ${await response.text().catch(() => "")}`);
    }
  } catch (error) {
    console.warn(`[notify] ntfy POST failed: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const state = createNotifyState(ctx.options);
    if (!state.options.enabled) return;
    if (!state.options.topic) {
      console.warn("[notify] no topic configured — delivery disabled until opencode.json sets one");
      return;
    }

    // Detached event loop: never blocks setup, every error fails open.
    void (async () => {
      try {
        const stream = (await ctx.event.subscribe()) as AsyncIterable<unknown>;
        for await (const raw of stream) {
          try {
            const event = (raw ?? {}) as EventLike;
            if (!isSupportedEvent(event.type)) continue;
            if (!passesFilter(event.type, state.options.events)) continue;
            const { sessionID, errorMessage } = eventData(event);
            if (!sessionID) continue;
            const notification = toNotification(event.type, sessionID, errorMessage);
            if (!notification) continue;
            await postNtfy(state.options, notification.title, notification.message, notification.tags, notification.priority);
          } catch (error) {
            console.warn(`[notify] event handling skipped: ${String(error)}`);
          }
        }
      } catch (error) {
        console.warn(`[notify] event stream ended: ${String(error)}`);
      }
    })();
  },
});

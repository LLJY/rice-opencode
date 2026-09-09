import { describe, expect, it } from "bun:test";

import {
  isSupportedEvent,
  passesFilter,
  toNotification,
  validateOptions,
} from "./policy";

describe("validateOptions", () => {
  it("defaults to enabled with no topic (delivery stays off)", () => {
    expect(validateOptions()).toEqual({
      enabled: true,
      server: "https://ntfy.sh",
      topic: "",
      token: "",
      events: { succeeded: true, failed: true },
      timeoutMs: 8000,
    });
  });

  it("accepts a full config and rejects bad shapes", () => {
    const opts = validateOptions({
      server: "https://ntfy.example.com/",
      topic: "ops",
      token: "tk_1",
      events: { succeeded: false },
      timeoutMs: 5000,
    });
    expect(opts).toMatchObject({
      server: "https://ntfy.example.com",
      topic: "ops",
      events: { succeeded: false, failed: true },
    });
    expect(() => validateOptions({ server: "not-a-url" })).toThrow();
    expect(() => validateOptions({ timeoutMs: 5 })).toThrow();
    expect(() => validateOptions("nope")).toThrow();
  });
});

describe("event mapping", () => {
  it("maps execution events to notifications with tags", () => {
    const ok = toNotification("session.execution.succeeded", "ses_1")!;
    expect(ok.tags).toBe("hourglass_done");
    expect(ok.message).toContain("ses_1");
    const failed = toNotification("session.execution.failed", "ses_2", "boom")!;
    expect(failed.tags).toBe("warning");
    expect(failed.message).toContain("boom");
  });

  it("filters by type and config", () => {
    expect(isSupportedEvent("session.execution.succeeded")).toBe(true);
    expect(isSupportedEvent("session.created")).toBe(false);
    expect(passesFilter("session.execution.succeeded", { succeeded: false, failed: true })).toBe(false);
    expect(passesFilter("session.execution.failed", { succeeded: false, failed: true })).toBe(true);
  });
});

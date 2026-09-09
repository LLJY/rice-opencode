import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWorkplan } from "../../scripts/check-workplan";
import { workplan_create } from "../../src/custom-tools/workplan/create";

describe("native V2 workplan structural check", () => {
  it("accepts a tool-generated version-2 plan without modifying either artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "workplan-check-"));
    try {
      await workplan_create.execute({
        id: "demo", kind: "software-engineering", goal: "Implement clamp", status: "draft", overwrite: false,
        phases: [{ title: "Implement", steps: [{ title: "Clamp", action: "Implement clamp", validation: "Run five range assertions" }] }],
      }, { directory: root, worktree: root, metadata() {} } as never);
      const jsonPath = join(root, ".opencode/workplan/demo.json");
      const mdPath = join(root, ".opencode/workplan/demo.md");
      const before = await Promise.all([readFile(jsonPath, "utf8"), readFile(mdPath, "utf8")]);
      expect(await checkWorkplan(root, "demo")).toEqual({ valid: true, issues: [] });
      expect(await Promise.all([readFile(jsonPath, "utf8"), readFile(mdPath, "utf8")])).toEqual(before);

      // A linked artifact is required; valid metadata alone is insufficient.
      await rm(mdPath);
      expect((await checkWorkplan(root, "demo")).valid).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects the incompatible fallback schema observed in the live planner test", async () => {
    const root = await mkdtemp(join(tmpdir(), "workplan-check-"));
    try {
      await mkdir(join(root, ".opencode/workplan"), { recursive: true });
      await writeFile(join(root, ".opencode/workplan/demo.json"), JSON.stringify({
        schemaVersion: 1, id: "demo", status: "pending", scope: { in: ["clamp"], out: [] },
        phases: [{ id: "phase-1", steps: [{ validation: ["verify it works"] }] }],
      }));
      const result = await checkWorkplan(root, "demo");
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue: string) => issue.startsWith("schemaVersion:"))).toBe(true);
      expect(result.issues.some((issue: string) => issue.startsWith("status:"))).toBe(true);
      expect(result.issues.some((issue: string) => issue.startsWith("scope:"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { workplan_create } from "../../src/custom-tools/workplan/create";
import { workplan_inspect } from "../../src/custom-tools/workplan/inspect";
import { workplan_list } from "../../src/custom-tools/workplan/list";
import { workplan_read } from "../../src/custom-tools/workplan/read";
import { workplan_reset } from "../../src/custom-tools/workplan/reset";
import { workplan_update } from "../../src/custom-tools/workplan/update";

const toolContext = (directory: string, worktree = directory) => ({
  directory,
  worktree,
  metadata() {},
});

describe("workplan tools", () => {
  it("creates readable prefixed ids and exposes them through inspect", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
          phases: [
            {
              title: "Discovery",
              steps: [
                {
                  title: "Inspect current schema",
                  action: "Read the current workplan files",
                  validation: "Confirm the shape",
                },
              ],
            },
          ],
        },
        toolContext(workspace) as never,
      );

      const inspectResult = JSON.parse(String(await workplan_inspect.execute({ id: "demo-plan" }, toolContext(workspace) as never))) as {
        phases: Array<{ id: string; markdownMarker: string }>;
        steps: Array<{ id: string; markdownMarker: string }>;
        plan: { exists: boolean };
      };

      expect(inspectResult.plan.exists).toBe(true);
      expect(inspectResult.phases).toHaveLength(1);
      expect(inspectResult.steps).toHaveLength(1);
      expect(inspectResult.phases[0]?.id).toMatch(/^phase-[a-z0-9]+-[a-z0-9]+-\d{6}$/);
      expect(inspectResult.steps[0]?.id).toMatch(/^step-[a-z0-9]+-[a-z0-9]+-\d{6}$/);
      expect(inspectResult.phases[0]?.markdownMarker).toContain(inspectResult.phases[0]!.id);
      expect(inspectResult.steps[0]?.markdownMarker).toContain(inspectResult.steps[0]!.id);

      const markdown = readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.md"), "utf8");
      expect(markdown).toContain(inspectResult.phases[0]!.markdownMarker);
      expect(markdown).toContain(inspectResult.steps[0]!.markdownMarker);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("defaults workplan storage to context.worktree instead of a subdirectory cwd", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));
    const nested = join(workspace, "packages", "demo");

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });
      mkdirSync(nested, { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Store the plan at the workspace root",
          status: "draft",
          overwrite: false,
        },
        toolContext(nested, workspace) as never,
      );

      expect(readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.json"), "utf8")).toContain('"id": "demo-plan"');
      expect(() => readFileSync(join(nested, ".opencode", "workplan", "demo-plan.json"), "utf8")).toThrow();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("updates a targeted step without replacing the whole phase list", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
          phases: [
            {
              title: "Execution",
              steps: [
                {
                  title: "Patch the tool",
                  action: "Update the workplan tool",
                  validation: "Run focused checks",
                },
              ],
            },
          ],
        },
        toolContext(workspace) as never,
      );

      const before = JSON.parse(String(await workplan_inspect.execute({ id: "demo-plan" }, toolContext(workspace) as never))) as {
        phases: Array<{ id: string }>;
        steps: Array<{ id: string }>;
      };

      await workplan_update.execute(
        {
          id: "demo-plan",
          updateSteps: [
            {
              phaseId: before.phases[0]!.id,
              stepId: before.steps[0]!.id,
              status: "completed",
              action: "Update the workplan tool with targeted patches",
            },
          ],
        },
        toolContext(workspace) as never,
      );

      const document = JSON.parse(readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.json"), "utf8")) as {
        phases: Array<{ id: string; steps: Array<{ id: string; status: string; action?: string }> }>;
      };

      expect(document.phases[0]?.id).toBe(before.phases[0]!.id);
      expect(document.phases[0]?.steps[0]?.id).toBe(before.steps[0]!.id);
      expect(document.phases[0]?.steps[0]?.status).toBe("completed");
      expect(document.phases[0]?.steps[0]?.action).toBe("Update the workplan tool with targeted patches");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("preserves insertion order for repeated after-step or after-phase inserts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
          phases: [
            {
              id: "phase-anchor",
              title: "Anchor",
              steps: [
                {
                  id: "step-anchor",
                  title: "Anchor step",
                  action: "Keep me first",
                  validation: "Still first",
                },
              ],
            },
          ],
        },
        toolContext(workspace) as never,
      );

      await workplan_update.execute(
        {
          id: "demo-plan",
          addPhases: [
            { afterPhaseId: "phase-anchor", phase: { id: "phase-b", title: "Phase B" } },
            { afterPhaseId: "phase-anchor", phase: { id: "phase-c", title: "Phase C" } },
          ],
          addSteps: [
            {
              phaseId: "phase-anchor",
              afterStepId: "step-anchor",
              step: { id: "step-b", title: "Step B", action: "Second", validation: "Second" },
            },
            {
              phaseId: "phase-anchor",
              afterStepId: "step-anchor",
              step: { id: "step-c", title: "Step C", action: "Third", validation: "Third" },
            },
          ],
        },
        toolContext(workspace) as never,
      );

      const document = JSON.parse(readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.json"), "utf8")) as {
        phases: Array<{ id: string; steps: Array<{ id: string }> }>;
      };

      expect(document.phases.map((phase) => phase.id)).toEqual(["phase-anchor", "phase-b", "phase-c"]);
      expect(document.phases[0]?.steps.map((step) => step.id)).toEqual(["step-anchor", "step-b", "step-c"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("refreshes moved plan markdown when the prior plan matched the generated template", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
          phases: [
            {
              id: "phase-anchor",
              title: "Execution",
              steps: [
                {
                  id: "step-anchor",
                  title: "Patch the tool",
                  action: "Old action",
                  validation: "Run focused checks",
                },
              ],
            },
          ],
        },
        toolContext(workspace) as never,
      );

      await workplan_update.execute(
        {
          id: "demo-plan",
          planFile: ".opencode/workplan/demo-plan-next.md",
          updateSteps: [
            {
              phaseId: "phase-anchor",
              stepId: "step-anchor",
              action: "New action",
            },
          ],
        },
        toolContext(workspace) as never,
      );

      const markdown = readFileSync(join(workspace, ".opencode", "workplan", "demo-plan-next.md"), "utf8");
      expect(markdown).toContain("New action");
      expect(markdown).toContain("demo-plan-next.md");
      expect(markdown).not.toContain("Old action");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rejects planFile updates outside .opencode/workplan", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
        },
        toolContext(workspace) as never,
      );

      await expect(
        workplan_update.execute(
          {
            id: "demo-plan",
            planFile: "README.md",
          },
          toolContext(workspace) as never,
        ),
      ).rejects.toThrow("Plan file must stay under .opencode/workplan/");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rejects symlinked workplan markdown and json paths", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));
    const outside = mkdtempSync(join(tmpdir(), "workplan-tools-outside-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
        },
        toolContext(workspace) as never,
      );

      const planPath = join(workspace, ".opencode", "workplan", "demo-plan.md");
      rmSync(planPath, { force: true });
      writeFileSync(join(outside, "outside.md"), "outside\n", "utf8");
      symlinkSync(join(outside, "outside.md"), planPath);

      await expect(workplan_update.execute({ id: "demo-plan", appendNotes: ["x"] }, toolContext(workspace) as never)).rejects.toThrow(
        "Plan file must not be a symlink",
      );

      rmSync(planPath, { force: true });
      writeFileSync(planPath, "# restored\n", "utf8");

      const jsonPath = join(workspace, ".opencode", "workplan", "demo-plan.json");
      const jsonRaw = readFileSync(jsonPath, "utf8");
      rmSync(jsonPath, { force: true });
      writeFileSync(join(outside, "outside.json"), jsonRaw, "utf8");
      symlinkSync(join(outside, "outside.json"), jsonPath);

      await expect(workplan_read.execute({ id: "demo-plan" }, toolContext(workspace) as never)).rejects.toThrow(
        "Workplan file must not be a symlink",
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked workplan directory during listing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));
    const outside = mkdtempSync(join(tmpdir(), "workplan-tools-outside-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });
      mkdirSync(join(outside, "workplan"), { recursive: true });
      writeFileSync(join(outside, "workplan", "outside.json"), "{}\n", "utf8");

      symlinkSync(join(outside, "workplan"), join(workspace, ".opencode", "workplan"));

      await expect(workplan_list.execute({}, toolContext(workspace) as never)).rejects.toThrow("Workplan directory must not be a symlink");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked workplan json file during listing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));
    const outside = mkdtempSync(join(tmpdir(), "workplan-tools-outside-"));

    try {
      mkdirSync(join(workspace, ".opencode", "workplan"), { recursive: true });
      writeFileSync(join(outside, "outside.json"), "{}\n", "utf8");
      symlinkSync(join(outside, "outside.json"), join(workspace, ".opencode", "workplan", "evil.json"));

      await expect(workplan_list.execute({}, toolContext(workspace) as never)).rejects.toThrow("Workplan file must not be a symlink");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("normalizes removeSpecFiles before filtering stored spec paths", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });
      mkdirSync(join(workspace, "docs"), { recursive: true });
      writeFileSync(join(workspace, "docs", "spec.md"), "# Spec\n", "utf8");

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
          specFiles: ["docs/spec.md"],
        },
        toolContext(workspace) as never,
      );

      const planJsonPath = join(workspace, ".opencode", "workplan", "demo-plan.json");
      const documentWithLegacySpecPath = JSON.parse(readFileSync(planJsonPath, "utf8")) as { specFiles: string[] };
      documentWithLegacySpecPath.specFiles = ["./docs/spec.md"];
      writeFileSync(planJsonPath, `${JSON.stringify(documentWithLegacySpecPath, null, 2)}\n`, "utf8");

      await workplan_update.execute(
        {
          id: "demo-plan",
          removeSpecFiles: ["./docs/spec.md"],
        },
        toolContext(workspace) as never,
      );

      const document = JSON.parse(readFileSync(planJsonPath, "utf8")) as {
        specFiles: string[];
      };
      expect(document.specFiles).toEqual([]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("deduplicates spec files after normalization", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });
      mkdirSync(join(workspace, "docs"), { recursive: true });
      writeFileSync(join(workspace, "docs", "spec.md"), "# Spec\n", "utf8");

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
          specFiles: ["docs/spec.md", "./docs/spec.md"],
        },
        toolContext(workspace) as never,
      );

      const document = JSON.parse(readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.json"), "utf8")) as {
        specFiles: string[];
      };
      expect(document.specFiles).toEqual(["docs/spec.md"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("can replace review findings to resolve an existing major finding", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "review",
          overwrite: false,
          reviewFindings: [{ severity: "major", title: "Fix ordering", status: "open" }],
        },
        toolContext(workspace) as never,
      );

      await workplan_update.execute(
        {
          id: "demo-plan",
          reviewFindings: [{ severity: "major", title: "Fix ordering", status: "resolved" }],
        },
        toolContext(workspace) as never,
      );

      const document = JSON.parse(readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.json"), "utf8")) as {
        reviewFindings: Array<{ severity: string; status?: string; title: string }>;
      };

      expect(document.reviewFindings).toEqual([{ severity: "major", title: "Fix ordering", status: "resolved" }]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rejects targeted updates when legacy duplicate ids make the target ambiguous", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "draft",
          overwrite: false,
          phases: [
            {
              id: "phase-anchor",
              title: "Execution",
              steps: [
                { id: "step-dup", title: "Step one", action: "A", validation: "A" },
                { id: "step-two", title: "Step two", action: "B", validation: "B" },
              ],
            },
          ],
        },
        toolContext(workspace) as never,
      );

      const planJsonPath = join(workspace, ".opencode", "workplan", "demo-plan.json");
      const document = JSON.parse(readFileSync(planJsonPath, "utf8")) as {
        phases: Array<{ id: string; steps: Array<{ id: string; title: string; action?: string; validation?: string; status: string }> }>;
      };
      document.phases[0]!.steps[1]!.id = "step-dup";
      writeFileSync(planJsonPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

      await expect(
        workplan_update.execute(
          {
            id: "demo-plan",
            updateSteps: [{ phaseId: "phase-anchor", stepId: "step-dup", action: "C" }],
          },
          toolContext(workspace) as never,
        ),
      ).rejects.toThrow("duplicate step id");

      await expect(workplan_inspect.execute({ id: "demo-plan" }, toolContext(workspace) as never)).rejects.toThrow("duplicate step id");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("resets a workplan back to draft state and regenerates markdown", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "review",
          overwrite: false,
          relevantFiles: ["src/app.ts"],
          specFiles: ["docs/spec.md"],
          phases: [
            {
              id: "phase-anchor",
              title: "Execution",
              steps: [{ id: "step-anchor", title: "Patch the tool", action: "Do it", validation: "Check it" }],
            },
          ],
          reviewFindings: [{ severity: "major", title: "Fix ordering" }],
          notes: ["temporary note"],
        },
        toolContext(workspace) as never,
      );

      await workplan_reset.execute(
        {
          id: "demo-plan",
          mode: "draft",
          preserveNotes: false,
        },
        toolContext(workspace) as never,
      );

      const document = JSON.parse(readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.json"), "utf8")) as {
        status: string;
        phases: unknown[];
        reviewFindings: unknown[];
        notes: unknown[];
        relevantFiles: string[];
        specFiles: string[];
      };
      const markdown = readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.md"), "utf8");

      expect(document.status).toBe("draft");
      expect(document.phases).toEqual([]);
      expect(document.reviewFindings).toEqual([]);
      expect(document.notes).toEqual([]);
      expect(document.relevantFiles).toEqual(["src/app.ts"]);
      expect(document.specFiles).toEqual(["docs/spec.md"]);
      expect(markdown).toContain("_No phases defined yet._");
      expect(markdown).toContain("Overall status: draft");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("can regenerate markdown only without clearing workplan state", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "workplan-tools-"));

    try {
      mkdirSync(join(workspace, ".opencode"), { recursive: true });

      await workplan_create.execute(
        {
          id: "demo-plan",
          kind: "general",
          goal: "Ship the new workplan flow",
          status: "review",
          overwrite: false,
          phases: [
            {
              id: "phase-anchor",
              title: "Execution",
              steps: [{ id: "step-anchor", title: "Patch the tool", action: "Do it", validation: "Check it" }],
            },
          ],
        },
        toolContext(workspace) as never,
      );

      const planPath = join(workspace, ".opencode", "workplan", "demo-plan.md");
      writeFileSync(planPath, "stale markdown\n", "utf8");

      await workplan_reset.execute(
        {
          id: "demo-plan",
          mode: "markdown-only",
          preserveNotes: false,
        },
        toolContext(workspace) as never,
      );

      const document = JSON.parse(readFileSync(join(workspace, ".opencode", "workplan", "demo-plan.json"), "utf8")) as {
        status: string;
        phases: Array<{ id: string }>;
      };
      const markdown = readFileSync(planPath, "utf8");

      expect(document.status).toBe("review");
      expect(document.phases.map((phase) => phase.id)).toEqual(["phase-anchor"]);
      expect(markdown).toContain("workplan-phase-id");
      expect(markdown).toContain("Overall status: review");
      expect(markdown).not.toContain("stale markdown");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

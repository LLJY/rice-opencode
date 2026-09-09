import { resolve } from "node:path";
import { tool } from "@opencode-ai/plugin";
import { workplanFindingSchema, workplanPhaseSchema, workplanStepSchema } from "../src/custom-tools/workplan/schemas";
import { normalizeId, readOptionalFile, workplanPath } from "../src/custom-tools/workplan/shared";
import { WORKPLAN_STATUSES } from "../src/custom-tools/workplan/types";
import { workplan_validate } from "../src/custom-tools/workplan/validate";

const nonempty = tool.schema.string().trim().min(1);
const status = tool.schema.enum(WORKPLAN_STATUSES);
const strings = tool.schema.array(tool.schema.string());
const step = workplanStepSchema.extend({ id: nonempty, action: nonempty, validation: nonempty, status });
const phase = workplanPhaseSchema.extend({ id: nonempty, status, steps: tool.schema.array(step).min(1) });
const document = tool.schema.object({
  schemaVersion: tool.schema.literal(2),
  id: nonempty,
  kind: nonempty,
  title: tool.schema.string().nullable(),
  goal: nonempty,
  scope: strings,
  nonGoals: strings,
  constraints: strings,
  relevantFiles: strings,
  planFile: nonempty,
  specFiles: strings.optional(),
  phases: tool.schema.array(phase).min(1),
  reviewFindings: tool.schema.array(workplanFindingSchema),
  notes: strings,
  status,
  createdAt: tool.schema.string().datetime(),
  updatedAt: tool.schema.string().datetime(),
});

/** Read-only structural check for V2 sessions where custom workplan tools are unavailable. */
export async function checkWorkplan(workspaceRoot: string, id: string) {
  const root = resolve(workspaceRoot);
  const path = workplanPath(root, id);
  try {
    const content = await readOptionalFile(root, path, "Workplan file");
    if (content === null) throw new Error(`Workplan file not found: ${path}`);
    const parsed = document.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return { valid: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
    }
    if (parsed.data.id !== normalizeId(id)) throw new Error("Document id does not match its filename");
    const validation = await workplan_validate.execute(
      { workspaceRoot: root, id },
      { directory: root, worktree: root, metadata() {} } as never,
    );
    const result = JSON.parse(typeof validation === "string" ? validation : validation.output);
    return { valid: result.valid === true, issues: result.issues as string[] };
  } catch (error) {
    return { valid: false, issues: [error instanceof Error ? error.message : String(error)] };
  }
}

if (import.meta.main) {
  const [root, id, ...extra] = Bun.argv.slice(2);
  if (!root || !id || extra.length) {
    process.stderr.write("Usage: bun scripts/check-workplan.ts <workspace-root> <workplan-id>\n");
    process.exitCode = 2;
  } else {
    const result = await checkWorkplan(root, id);
    process.stdout.write(`${JSON.stringify({ ...result, gate: "structure", note: "Does not establish readiness, authorization, or completion." }, null, 2)}\n`);
    process.exitCode = result.valid ? 0 : 1;
  }
}

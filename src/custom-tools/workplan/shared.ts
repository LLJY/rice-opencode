import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  FindingSeverity,
  WorkplanDocument,
  WorkplanFinding,
  WorkplanPhase,
  WorkplanStatus,
  WorkplanStep,
} from "./types";

const ID_ADJECTIVES = [
  "amber",
  "brisk",
  "cedar",
  "clear",
  "cobalt",
  "ember",
  "fern",
  "gentle",
  "lively",
  "maple",
  "moss",
  "nimble",
  "quiet",
  "river",
  "silver",
  "spruce",
  "steady",
  "swift",
  "wild",
  "young",
] as const;

const ID_NOUNS = [
  "anchor",
  "branch",
  "bridge",
  "comet",
  "field",
  "forge",
  "harbor",
  "lantern",
  "meadow",
  "orbit",
  "path",
  "petal",
  "pine",
  "reef",
  "signal",
  "slope",
  "spark",
  "stream",
  "summit",
  "trail",
] as const;

export function formatOutput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

export function resolveWorkspaceRoot(baseDirectory: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return resolve(baseDirectory);
  const expanded = expandHome(workspaceRoot);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDirectory, expanded);
}

export function resolveToolWorkspaceRoot(
  context: { directory: string; worktree?: string },
  workspaceRoot?: string,
): string {
  return resolveWorkspaceRoot(context.worktree ?? context.directory, workspaceRoot);
}

export function normalizeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (!normalized) throw new Error("Workplan id must contain at least one letter or number");
  return normalized;
}

function randomListValue(values: readonly string[]): string {
  return values[Math.floor(Math.random() * values.length)] ?? values[0]!;
}

export function createReadableId(prefix: string, usedIds?: ReadonlySet<string>): string {
  const normalizedPrefix = normalizeId(prefix);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const digits = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0");
    const candidate = `${normalizedPrefix}-${randomListValue(ID_ADJECTIVES)}-${randomListValue(ID_NOUNS)}-${digits}`;
    if (!usedIds?.has(candidate)) return candidate;
  }

  const fallback = `${normalizedPrefix}-${Date.now().toString().slice(-6)}`;
  if (!usedIds?.has(fallback)) return fallback;
  throw new Error(`Unable to generate unique ${normalizedPrefix} id`);
}

export function ensureEntityId(prefix: string, explicitId: string | undefined, usedIds?: Set<string>): string {
  const id = explicitId ? normalizeId(explicitId) : createReadableId(prefix, usedIds);
  if (usedIds?.has(id)) throw new Error(`Duplicate ${prefix} id: ${id}`);
  usedIds?.add(id);
  return id;
}

export function phaseMarker(id: string): string {
  return `<!-- workplan-phase-id: ${normalizeId(id)} -->`;
}

export function stepMarker(id: string): string {
  return `<!-- workplan-step-id: ${normalizeId(id)} -->`;
}

export function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

export function isWithinWorkspaceRoot(workspaceRoot: string, candidatePath: string): boolean {
  const root = resolve(workspaceRoot);
  const candidate = resolve(candidatePath);

  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(`${sep}..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

export function normalizeSpecFiles(workspaceRoot: string, values: string[] | undefined): string[] {
  return uniqueStrings((values ?? []).map((specFile) => normalizeWorkspaceFile(workspaceRoot, specFile, "Spec file")));
}

export function resolveWorkspaceFile(workspaceRoot: string, value: string): string {
  const expanded = expandHome(value.trim());
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workspaceRoot, expanded);
}

export function normalizeWorkspaceFile(workspaceRoot: string, value: string, label = "File"): string {
  const resolvedPath = resolveWorkspaceFile(workspaceRoot, value);
  if (!isWithinWorkspaceRoot(workspaceRoot, resolvedPath)) {
    throw new Error(`${label} must stay inside workspace root: ${value}`);
  }

  const normalized = relative(resolve(workspaceRoot), resolvedPath);
  if (!normalized || normalized === ".") throw new Error(`${label} must point to a file inside the workspace root: ${value}`);
  return normalized;
}

export function normalizePlanFile(workspaceRoot: string, value: string): string {
  const normalized = normalizeWorkspaceFile(workspaceRoot, value, "Plan file");
  const workplanPrefix = `${join(".opencode", "workplan")}${sep}`;

  if (!normalized.startsWith(workplanPrefix)) {
    throw new Error(`Plan file must stay under .opencode/workplan/: ${value}`);
  }
  if (!normalized.endsWith(".md")) {
    throw new Error(`Plan file must be Markdown under .opencode/workplan/: ${value}`);
  }

  return normalized;
}

export function workplanDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "workplan");
}

export function workplanPath(workspaceRoot: string, id: string): string {
  return join(workspaceRoot, ".opencode", "workplan", `${normalizeId(id)}.json`);
}

export function workplanMarkdownPath(workspaceRoot: string, id: string): string {
  return join(workspaceRoot, ".opencode", "workplan", `${normalizeId(id)}.md`);
}

export async function ensureWorkplanDirectory(workspaceRoot: string): Promise<string> {
  const directory = workplanDirectory(workspaceRoot);
  await assertSafePathAccess(workspaceRoot, directory, "Workplan directory");
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

export async function ensureParentDirectory(path: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
}

async function resolveRealWorkspaceRoot(workspaceRoot: string): Promise<string> {
  return await fs.realpath(workspaceRoot).catch(() => resolve(workspaceRoot));
}

export async function assertSafePathAccess(workspaceRoot: string, targetPath: string, label: string): Promise<void> {
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const realWorkspaceRoot = await resolveRealWorkspaceRoot(workspaceRoot);
  const candidatePath = resolve(targetPath);

  if (!isWithinWorkspaceRoot(resolvedWorkspaceRoot, candidatePath)) {
    throw new Error(`${label} must stay inside workspace root: ${targetPath}`);
  }

  const relativePath = relative(resolvedWorkspaceRoot, candidatePath);
  if (!relativePath || relativePath === ".") return;

  let currentPath = resolvedWorkspaceRoot;
  for (const segment of relativePath.split(sep)) {
    currentPath = join(currentPath, segment);

    try {
      const stats = await fs.lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`${label} must not be a symlink: ${currentPath}`);
      }

      const realPath = await fs.realpath(currentPath);
      if (!isWithinWorkspaceRoot(realWorkspaceRoot, realPath)) {
        throw new Error(`${label} resolves outside workspace root: ${currentPath}`);
      }
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function readWorkplanDocument(
  workspaceRoot: string,
  id: string,
): Promise<{ path: string; document: WorkplanDocument }> {
  const path = workplanPath(workspaceRoot, id);
  await assertSafePathAccess(workspaceRoot, path, "Workplan file");
  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw) as WorkplanDocument & { specFiles?: string[]; planFile?: string };

  if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 2 || !parsed.planFile?.trim()) {
    throw new Error(`Invalid workplan document at ${path}`);
  }

  return {
    path,
    document: {
      ...parsed,
      planFile: normalizePlanFile(workspaceRoot, parsed.planFile),
      specFiles: normalizeSpecFiles(workspaceRoot, parsed.specFiles),
    },
  };
}

export async function writeWorkplanDocument(workspaceRoot: string, path: string, document: WorkplanDocument): Promise<void> {
  await assertSafePathAccess(workspaceRoot, path, "Workplan file");
  await ensureParentDirectory(path);
  await fs.writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export async function readOptionalFile(workspaceRoot: string, path: string, label = "File"): Promise<string | null> {
  await assertSafePathAccess(workspaceRoot, path, label);
  try {
    return await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

export function resolveLinkedPlanPath(workspaceRoot: string, document: WorkplanDocument): string {
  return resolveWorkspaceFile(workspaceRoot, document.planFile);
}

export async function writeWorkplanMarkdown(workspaceRoot: string, path: string, content: string): Promise<void> {
  await assertSafePathAccess(workspaceRoot, path, "Plan file");
  await ensureParentDirectory(path);
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  await fs.writeFile(path, normalized, "utf8");
}

function renderList(items: string[], empty = "_None_"): string {
  if (items.length === 0) return empty;
  return items.map((item) => `- ${item}`).join("\n");
}

function renderReviewFindings(findings: WorkplanDocument["reviewFindings"]): string {
  if (findings.length === 0) return "_None_";

  return findings
    .map((finding) => {
      const parts = [`- [${finding.severity}] ${finding.title}`];
      if (finding.status) parts.push(`(${finding.status})`);
      if (finding.detail) parts.push(`— ${finding.detail}`);
      if (finding.source) parts.push(` [source: ${finding.source}]`);
      return parts.join("");
    })
    .join("\n");
}

function renderPhases(phases: WorkplanDocument["phases"]): string {
  if (phases.length === 0) return "_No phases defined yet._";

  return phases
    .map((phase, phaseIndex) => {
      const phaseLines = [`### ${phaseIndex + 1}. ${phase.title} ${phaseMarker(phase.id)}`, `- Status: ${phase.status}`, `- Id: ${phase.id}`];

      if (phase.steps.length === 0) {
        phaseLines.push("- Steps: _None yet_");
      } else {
        for (const [stepIndex, step] of phase.steps.entries()) {
          phaseLines.push(`#### ${phaseIndex + 1}.${stepIndex + 1} ${step.title} ${stepMarker(step.id)}`);
          phaseLines.push(`- Status: ${step.status}`);
          phaseLines.push(`- Id: ${step.id}`);
          if (step.target) phaseLines.push(`- Target: ${step.target}`);
          if (step.action) phaseLines.push(`- Action: ${step.action}`);
          if (step.validation) phaseLines.push(`- Validation: ${step.validation}`);
        }
      }

      return phaseLines.join("\n");
    })
    .join("\n\n");
}

export function renderWorkplanMarkdown(document: WorkplanDocument): string {
  const title = document.title?.trim() || document.id;

  return [
    `# ${title}`,
    "",
    "## Goal",
    document.goal,
    "",
    "## Scope",
    renderList(document.scope),
    "",
    "## Non-goals",
    renderList(document.nonGoals),
    "",
    "## Constraints",
    renderList(document.constraints),
    "",
    "## Relevant files",
    renderList(document.relevantFiles),
    "",
    "## Spec files",
    renderList(document.specFiles),
    "",
    "## Execution phases",
    renderPhases(document.phases),
    "",
    "## Adversarial review findings",
    renderReviewFindings(document.reviewFindings),
    "",
    "## Notes",
    renderList(document.notes),
    "",
    "## Status",
    `- Overall status: ${document.status}`,
    `- Metadata file: .opencode/workplan/${document.id}.json`,
    `- Detailed plan file: ${document.planFile}`,
    "",
  ].join("\n");
}

export function normalizeStep(
  step: {
    id?: string;
    title: string;
    target?: string;
    action?: string;
    validation?: string;
    status?: WorkplanStatus;
  },
  index: number,
  options?: { usedIds?: Set<string> },
): WorkplanStep {
  const title = step.title.trim();
  if (!title) throw new Error(`Step ${index + 1} is missing a title`);

  return {
    id: ensureEntityId("step", step.id, options?.usedIds),
    title,
    target: step.target?.trim() || undefined,
    action: step.action?.trim() || undefined,
    validation: step.validation?.trim() || undefined,
    status: step.status ?? "draft",
  };
}

export function normalizePhase(
  phase: {
    id?: string;
    title: string;
    status?: WorkplanStatus;
    steps?: Array<{
      id?: string;
      title: string;
      target?: string;
      action?: string;
      validation?: string;
      status?: WorkplanStatus;
    }>;
  },
  index: number,
  options?: { usedPhaseIds?: Set<string> },
): WorkplanPhase {
  const title = phase.title.trim();
  if (!title) throw new Error(`Phase ${index + 1} is missing a title`);
  const stepIds = new Set<string>();

  return {
    id: ensureEntityId("phase", phase.id, options?.usedPhaseIds),
    title,
    status: phase.status ?? "draft",
    steps: (phase.steps ?? []).map((step, stepIndex) => normalizeStep(step, stepIndex, { usedIds: stepIds })),
  };
}

export function getPhaseById(document: WorkplanDocument, phaseId: string): { phase: WorkplanPhase; index: number } {
  const normalizedPhaseId = normalizeId(phaseId);
  const index = document.phases.findIndex((phase) => phase.id === normalizedPhaseId);
  if (index < 0) throw new Error(`Phase not found: ${normalizedPhaseId}`);
  return { phase: document.phases[index]!, index };
}

export function getStepById(phase: WorkplanPhase, stepId: string): { step: WorkplanStep; index: number } {
  const normalizedStepId = normalizeId(stepId);
  const index = phase.steps.findIndex((step) => step.id === normalizedStepId);
  if (index < 0) throw new Error(`Step not found in phase ${phase.id}: ${normalizedStepId}`);
  return { step: phase.steps[index]!, index };
}

export function assertUniqueWorkplanIds(document: WorkplanDocument): void {
  const phaseIds = new Set<string>();

  for (const phase of document.phases) {
    if (phaseIds.has(phase.id)) {
      throw new Error(`Workplan ${document.id} has duplicate phase id: ${phase.id}. Migrate ids before targeted inspect or update calls.`);
    }
    phaseIds.add(phase.id);

    const stepIds = new Set<string>();
    for (const step of phase.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`Workplan ${document.id} has duplicate step id in phase ${phase.id}: ${step.id}. Migrate ids before targeted inspect or update calls.`);
      }
      stepIds.add(step.id);
    }
  }
}

export function normalizeFinding(
  finding: {
    severity: FindingSeverity;
    title: string;
    detail?: string;
    source?: string;
    status?: "open" | "resolved";
  },
  index: number,
): WorkplanFinding {
  const title = finding.title.trim();
  if (!title) throw new Error(`Finding ${index + 1} is missing a title`);

  return {
    severity: finding.severity,
    title,
    detail: finding.detail?.trim() || undefined,
    source: finding.source?.trim() || undefined,
    status: finding.status ?? "open",
  };
}

export function summarize(document: WorkplanDocument) {
  const phaseCount = document.phases.length;
  const stepCount = document.phases.reduce((total, phase) => total + phase.steps.length, 0);
  const openFindingCount = document.reviewFindings.filter((finding) => finding.status !== "resolved").length;

  return {
    id: document.id,
    kind: document.kind,
    title: document.title,
    goal: document.goal,
    status: document.status,
    planFile: document.planFile,
    phaseCount,
    stepCount,
    specFileCount: document.specFiles?.length ?? 0,
    openFindingCount,
    updatedAt: document.updatedAt,
  };
}

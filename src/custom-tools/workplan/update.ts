import { promises as fs } from "node:fs";

import { tool } from "../tool";

import {
  workplanFindingSchema,
  workplanPhaseInsertSchema,
  workplanPhasePatchSchema,
  workplanPhaseSchema,
  workplanStepInsertSchema,
  workplanStepPatchSchema,
} from "./schemas";
import {
  assertUniqueWorkplanIds,
  formatOutput,
  getPhaseById,
  getStepById,
  normalizeFinding,
  normalizePhase,
  normalizePlanFile,
  normalizeStep,
  normalizeSpecFiles,
  readOptionalFile,
  readWorkplanDocument,
  renderWorkplanMarkdown,
  resolveLinkedPlanPath,
  resolveToolWorkspaceRoot,
  summarize,
  uniqueStrings,
  writeWorkplanDocument,
  writeWorkplanMarkdown,
} from "./shared";
import { WORKPLAN_STATUSES } from "./types";

function nonBlankString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim() ? value : undefined;
}

function nonEmptyArray<T>(value: T[] | undefined): T[] | undefined {
  return value?.length ? value : undefined;
}

function nonDefaultStatus(value: (typeof WORKPLAN_STATUSES)[number] | undefined): (typeof WORKPLAN_STATUSES)[number] | undefined {
  // Tool callers in some OpenCode frontends provide the first enum value for
  // omitted optional status fields. Treat draft as the placeholder value and
  // use workplan_reset for explicit draft resets.
  if (value === undefined || value === "draft") return undefined;
  return value;
}

function compactPhasePatches(patches: Array<{ phaseId: string; title?: string; status?: (typeof WORKPLAN_STATUSES)[number] }> | undefined) {
  return nonEmptyArray(patches)
    ?.map((patch) => ({
      ...patch,
      title: nonBlankString(patch.title),
      status: nonDefaultStatus(patch.status),
    }))
    .filter((patch) => patch.title !== undefined || patch.status !== undefined);
}

function compactStepPatches(
  patches:
    | Array<{
        phaseId: string;
        stepId: string;
        title?: string;
        target?: string;
        action?: string;
        validation?: string;
        status?: (typeof WORKPLAN_STATUSES)[number];
      }>
    | undefined,
) {
  return nonEmptyArray(patches)
    ?.map((patch) => ({
      ...patch,
      title: nonBlankString(patch.title),
      target: nonBlankString(patch.target),
      action: nonBlankString(patch.action),
      validation: nonBlankString(patch.validation),
      status: nonDefaultStatus(patch.status),
    }))
    .filter(
      (patch) =>
        patch.title !== undefined ||
        patch.target !== undefined ||
        patch.action !== undefined ||
        patch.validation !== undefined ||
        patch.status !== undefined,
    );
}

export const workplan_update = tool({
  description: "Update a structured workplan's JSON metadata, linked Markdown plan path, files, findings, or targeted phase and step fields without rewriting the whole document manually.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
    id: tool.schema.string().describe("Workplan id"),
    title: tool.schema.string().optional().describe("Replace the workplan title"),
    goal: tool.schema.string().optional().describe("Replace the workplan goal"),
    status: tool.schema.enum(WORKPLAN_STATUSES).optional().describe("Replace the overall workplan status"),
    scope: tool.schema.array(tool.schema.string()).optional().describe("Replace the scope list"),
    nonGoals: tool.schema.array(tool.schema.string()).optional().describe("Replace the non-goals list"),
    constraints: tool.schema.array(tool.schema.string()).optional().describe("Replace the constraints list"),
    planFile: tool.schema.string().optional().describe("Replace the linked Markdown plan path"),
    planMarkdown: tool.schema.string().optional().describe("Replace the full Markdown content for the linked plan file"),
    specFiles: tool.schema.array(tool.schema.string()).optional().describe("Replace the full spec file list"),
    reviewFindings: tool.schema.array(workplanFindingSchema).optional().describe("Replace the full review findings list"),
    phases: tool.schema.array(workplanPhaseSchema).optional().describe("Replace the full phase list"),
    updatePhases: tool.schema.array(workplanPhasePatchSchema).optional().describe("Patch existing phases by phase id"),
    addPhases: tool.schema.array(workplanPhaseInsertSchema).optional().describe("Append or insert new phases with stable ids"),
    updateSteps: tool.schema.array(workplanStepPatchSchema).optional().describe("Patch existing steps by phase id and step id"),
    addSteps: tool.schema.array(workplanStepInsertSchema).optional().describe("Append or insert new steps with stable ids"),
    addRelevantFiles: tool.schema.array(tool.schema.string()).optional().describe("Append relevant files and de-duplicate"),
    addSpecFiles: tool.schema.array(tool.schema.string()).optional().describe("Append spec files and de-duplicate"),
    removeSpecFiles: tool.schema.array(tool.schema.string()).optional().describe("Remove spec files from the current list"),
    addReviewFindings: tool.schema.array(workplanFindingSchema).optional().describe("Append review findings"),
    appendNotes: tool.schema.array(tool.schema.string()).optional().describe("Append freeform notes"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    const { path, document } = await readWorkplanDocument(workspaceRoot, args.id);
    const previousDocument = JSON.parse(JSON.stringify(document)) as typeof document;
    const previousPlanPath = resolveLinkedPlanPath(workspaceRoot, document);
    const previousPlanContent = await readOptionalFile(workspaceRoot, previousPlanPath, "Plan file");
    const previousPlanWasGenerated = previousPlanContent !== null && previousPlanContent === renderWorkplanMarkdown(previousDocument);

    const title = nonBlankString(args.title);
    const goal = nonBlankString(args.goal);
    const status = nonDefaultStatus(args.status);
    const scope = nonEmptyArray(args.scope);
    const nonGoals = nonEmptyArray(args.nonGoals);
    const constraints = nonEmptyArray(args.constraints);
    const planFile = nonBlankString(args.planFile);
    const planMarkdown = nonBlankString(args.planMarkdown);
    const specFiles = nonEmptyArray(args.specFiles);
    const reviewFindings = nonEmptyArray(args.reviewFindings);
    const phases = nonEmptyArray(args.phases);
    const updatePhases = compactPhasePatches(args.updatePhases);
    const addPhases = nonEmptyArray(args.addPhases);
    const updateSteps = compactStepPatches(args.updateSteps);
    const addSteps = nonEmptyArray(args.addSteps);
    const addRelevantFiles = nonEmptyArray(args.addRelevantFiles);
    const addSpecFiles = nonEmptyArray(args.addSpecFiles);
    const removeSpecFiles = nonEmptyArray(args.removeSpecFiles);
    const addReviewFindings = nonEmptyArray(args.addReviewFindings);
    const appendNotes = nonEmptyArray(args.appendNotes);
    const updateFieldNames = [
      title !== undefined && "title",
      goal !== undefined && "goal",
      status !== undefined && "status",
      scope !== undefined && "scope",
      nonGoals !== undefined && "nonGoals",
      constraints !== undefined && "constraints",
      planFile !== undefined && "planFile",
      planMarkdown !== undefined && "planMarkdown",
      specFiles !== undefined && "specFiles",
      reviewFindings !== undefined && "reviewFindings",
      phases !== undefined && "phases",
      updatePhases?.length && "updatePhases",
      addPhases !== undefined && "addPhases",
      updateSteps?.length && "updateSteps",
      addSteps !== undefined && "addSteps",
      addRelevantFiles !== undefined && "addRelevantFiles",
      addSpecFiles !== undefined && "addSpecFiles",
      removeSpecFiles !== undefined && "removeSpecFiles",
      addReviewFindings !== undefined && "addReviewFindings",
      appendNotes !== undefined && "appendNotes",
    ].filter((field): field is string => Boolean(field));

    context.metadata({
      title: "Update workplan",
      metadata: {
        workspaceRoot,
        id: document.id,
        updateFields: updateFieldNames,
      },
    });

    const usesTargetedIds = Boolean(
      updatePhases?.length || updateSteps?.length || addSteps?.length || addPhases?.some((entry) => entry.afterPhaseId),
    );
    if (usesTargetedIds) assertUniqueWorkplanIds(document);

    if (title !== undefined) document.title = title.trim() || null;
    if (goal !== undefined) document.goal = goal.trim();
    if (status !== undefined) document.status = status;
    if (scope !== undefined) document.scope = uniqueStrings(scope);
    if (nonGoals !== undefined) document.nonGoals = uniqueStrings(nonGoals);
    if (constraints !== undefined) document.constraints = uniqueStrings(constraints);
    if (planFile !== undefined) document.planFile = normalizePlanFile(workspaceRoot, planFile);
    if (specFiles !== undefined) document.specFiles = normalizeSpecFiles(workspaceRoot, specFiles);
    if (reviewFindings !== undefined) document.reviewFindings = reviewFindings.map(normalizeFinding);
    if (phases !== undefined) {
      const usedPhaseIds = new Set<string>();
      document.phases = phases.map((phase, index) => normalizePhase(phase, index, { usedPhaseIds }));
    }
    if (updatePhases?.length) {
      for (const patch of updatePhases) {
        const { phase } = getPhaseById(document, patch.phaseId);
        if (patch.title !== undefined) {
          const title = patch.title.trim();
          if (!title) throw new Error(`Phase ${phase.id} title cannot be empty`);
          phase.title = title;
        }
        if (patch.status !== undefined) phase.status = patch.status;
      }
    }
    if (addPhases?.length) {
      const usedPhaseIds = new Set(document.phases.map((phase) => phase.id));
      const insertionOffsets = new Map<string, number>();
      for (const insertion of addPhases) {
        const phase = normalizePhase(insertion.phase, document.phases.length, { usedPhaseIds });
        if (!insertion.afterPhaseId) {
          document.phases.push(phase);
          continue;
        }

        const { phase: anchorPhase, index } = getPhaseById(document, insertion.afterPhaseId);
        const offset = insertionOffsets.get(anchorPhase.id) ?? 0;
        document.phases.splice(index + 1 + offset, 0, phase);
        insertionOffsets.set(anchorPhase.id, offset + 1);
      }
    }
    if (updateSteps?.length) {
      for (const patch of updateSteps) {
        const { phase } = getPhaseById(document, patch.phaseId);
        const { step } = getStepById(phase, patch.stepId);

        if (patch.title !== undefined) {
          const title = patch.title.trim();
          if (!title) throw new Error(`Step ${step.id} title cannot be empty`);
          step.title = title;
        }
        if (patch.target !== undefined) step.target = patch.target.trim() || undefined;
        if (patch.action !== undefined) step.action = patch.action.trim() || undefined;
        if (patch.validation !== undefined) step.validation = patch.validation.trim() || undefined;
        if (patch.status !== undefined) step.status = patch.status;
      }
    }
    if (addSteps?.length) {
      const insertionOffsets = new Map<string, number>();
      for (const insertion of addSteps) {
        const { phase } = getPhaseById(document, insertion.phaseId);
        const usedStepIds = new Set(phase.steps.map((step) => step.id));
        const step = normalizeStep(insertion.step, phase.steps.length, { usedIds: usedStepIds });
        if (!insertion.afterStepId) {
          phase.steps.push(step);
          continue;
        }

        const { step: anchorStep, index } = getStepById(phase, insertion.afterStepId);
        const insertionKey = `${phase.id}:${anchorStep.id}`;
        const offset = insertionOffsets.get(insertionKey) ?? 0;
        phase.steps.splice(index + 1 + offset, 0, step);
        insertionOffsets.set(insertionKey, offset + 1);
      }
    }
    if (addRelevantFiles?.length) {
      document.relevantFiles = uniqueStrings([...document.relevantFiles, ...addRelevantFiles]);
    }
    if (addSpecFiles?.length) {
      document.specFiles = normalizeSpecFiles(workspaceRoot, [...document.specFiles, ...addSpecFiles]);
    }
    if (removeSpecFiles?.length) {
      const removals = new Set(normalizeSpecFiles(workspaceRoot, removeSpecFiles));
      document.specFiles = document.specFiles.filter((specFile) => !removals.has(specFile));
    }
    if (addReviewFindings?.length) {
      document.reviewFindings.push(...addReviewFindings.map(normalizeFinding));
    }
    if (appendNotes?.length) {
      document.notes = uniqueStrings([...document.notes, ...appendNotes]);
    }

    document.updatedAt = new Date().toISOString();
    const planPath = resolveLinkedPlanPath(workspaceRoot, document);

    if (planFile !== undefined && planPath !== previousPlanPath) {
      try {
        await fs.access(planPath);
        throw new Error(`Refusing to overwrite existing plan file: ${document.planFile}`);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
    }

    const refreshGeneratedMarkdownFields = new Set([
      "title",
      "goal",
      "status",
      "scope",
      "nonGoals",
      "constraints",
      "specFiles",
      "reviewFindings",
      "phases",
      "updatePhases",
      "addPhases",
      "updateSteps",
      "addSteps",
      "addRelevantFiles",
      "addSpecFiles",
      "removeSpecFiles",
      "addReviewFindings",
      "appendNotes",
    ]);
    const shouldRefreshGeneratedMarkdown =
      planMarkdown === undefined &&
      planFile === undefined &&
      previousPlanWasGenerated &&
      updateFieldNames.some((key) => refreshGeneratedMarkdownFields.has(key));

    if (planMarkdown !== undefined) {
      await writeWorkplanMarkdown(workspaceRoot, planPath, planMarkdown);
    } else if (planFile !== undefined) {
      await writeWorkplanMarkdown(workspaceRoot, planPath, previousPlanWasGenerated ? renderWorkplanMarkdown(document) : previousPlanContent ?? renderWorkplanMarkdown(document));
    } else if (shouldRefreshGeneratedMarkdown) {
      await writeWorkplanMarkdown(workspaceRoot, planPath, renderWorkplanMarkdown(document));
    }

    await writeWorkplanDocument(workspaceRoot, path, document);
    return formatOutput({ updated: true, path, planPath, workplan: summarize(document) });
  },
});

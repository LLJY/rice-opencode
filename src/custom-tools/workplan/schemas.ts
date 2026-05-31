import { tool } from "@opencode-ai/plugin";

import { FINDING_SEVERITIES, WORKPLAN_STATUSES } from "./types";

export const workplanStepSchema = tool.schema.object({
  id: tool.schema.string().optional().describe("Optional stable step id; defaults to a generated readable id such as step-amber-bridge-123456"),
  title: tool.schema.string().describe("Step title"),
  target: tool.schema.string().optional().describe("File path, subsystem, or target area"),
  action: tool.schema.string().optional().describe("Concrete change or activity"),
  validation: tool.schema.string().optional().describe("How to verify this step"),
  status: tool.schema.enum(WORKPLAN_STATUSES).optional().describe("Optional step status"),
});

export const workplanPhaseSchema = tool.schema.object({
  id: tool.schema.string().optional().describe("Optional stable phase id; defaults to a generated readable id such as phase-amber-bridge-123456"),
  title: tool.schema.string().describe("Phase title"),
  status: tool.schema.enum(WORKPLAN_STATUSES).optional().describe("Optional phase status"),
  steps: tool.schema.array(workplanStepSchema).optional().describe("Optional steps for this phase"),
});

export const workplanPhasePatchSchema = tool.schema.object({
  phaseId: tool.schema.string().describe("Existing phase id to update"),
  title: tool.schema.string().optional().describe("Replace the phase title"),
  status: tool.schema.enum(WORKPLAN_STATUSES).optional().describe("Replace the phase status"),
});

export const workplanStepPatchSchema = tool.schema.object({
  phaseId: tool.schema.string().describe("Existing parent phase id"),
  stepId: tool.schema.string().describe("Existing step id to update"),
  title: tool.schema.string().optional().describe("Replace the step title"),
  target: tool.schema.string().optional().describe("Replace the step target; pass an empty string to clear it"),
  action: tool.schema.string().optional().describe("Replace the step action; pass an empty string to clear it"),
  validation: tool.schema.string().optional().describe("Replace the step validation; pass an empty string to clear it"),
  status: tool.schema.enum(WORKPLAN_STATUSES).optional().describe("Replace the step status"),
});

export const workplanPhaseInsertSchema = tool.schema.object({
  afterPhaseId: tool.schema.string().optional().describe("Insert after this phase id; omit to append"),
  phase: workplanPhaseSchema.describe("New phase to append or insert"),
});

export const workplanStepInsertSchema = tool.schema.object({
  phaseId: tool.schema.string().describe("Existing parent phase id"),
  afterStepId: tool.schema.string().optional().describe("Insert after this step id; omit to append"),
  step: workplanStepSchema.describe("New step to append or insert"),
});

export const workplanFindingSchema = tool.schema.object({
  severity: tool.schema.enum(FINDING_SEVERITIES).describe("Finding severity"),
  title: tool.schema.string().describe("Finding title"),
  detail: tool.schema.string().optional().describe("Optional detail"),
  source: tool.schema.string().optional().describe("Optional source such as file:line or command"),
  status: tool.schema.enum(["open", "resolved"]).optional().describe("Finding lifecycle state"),
});

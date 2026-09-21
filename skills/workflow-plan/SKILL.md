---
name: workflow-plan
description: Use during PLAN mode to create, revise, validate, and hand off durable workplans using workplan_* tools. Do not load unless the user says "use workflows"
compatibility: opencode
metadata:
  domain: software-engineering
  workflow: workplan-planning
---

# Goal

Turn a non-trivial software request into an execution-ready workplan with JSON
metadata and linked Markdown detail, without implementing production code.

# PLAN mode boundary

- In PLAN mode, do not implement application changes. Only use the workplan tools to edit plans.
- Use workplan tools to persist plan state instead of relying on chat memory.
- Direct edits should be limited to planning artifacts only when a workplan tool cannot express the change.
- End with a concrete handoff the user can approve or pass to an execution agent.

# Planning methodology

1. Re-read the user's request and constraints.
2. Inspect the workspace enough to identify relevant files, entry points, tests, configs, and risks.
3. Check for existing workplans before creating a new one.
4. Create or adopt one stable workplan id.
5. Capture structured state in JSON and detailed rationale/handoff prose in Markdown.
6. Ask and continuously go back and forth with the user on action items and clarifications that materially affect scope, architecture, safety, or validation.
7. DO NOT continue with an under-specified plan unless the user explicitly accepts the remaining uncertainty. Keep the user in the loop at every material step. Default to comprehensive planning.
8. When writing the plan, consider execution boundaries with parallel subagents. Identify areas that are parallelizable and areas with serial or cross-dependency constraints. The workflow should be massively parallel where possible, but take incredible care with cross dependencies and do not plan useless tiny tasks; subagents are capable engineers on their own.
9. The workflow plan should contain this execution workflow as specified: Slice A (parallel where necessary) `code-writer` -> `code-checker` (check entire slice, or sub-slices if too large) -> `code-writer` (Slice B) -> `code-checker` (Slice B), and so on until the task is completed.
10. Validate the workplan, using the tool AND the `plan-checker` agent.
11. If validation or `plan-checker` review finds issues, revise and revalidate.
12. Return a short handoff: workplan id, readiness, open questions, and execution command/agent suggestion.

IMPORTANT:
YAGNI, keep it as simple and straightforward as possible whilst staying correct. DO NOT allow pedantry to leak into the plan if the scope of complexity does not warrant it.

DO NOT load the workflow-execute skill unless planning has been completed. It's out of scope for planning.

# Workplan tool subset for planning

## Discovery and adoption

- `workplan_list`: use first when resuming, when the user names a project vaguely, or when a related plan may already exist.
- `workplan_read`: use when adopting an existing plan or when you need the full Markdown plus JSON metadata.
- `workplan_inspect`: use when you only need phase ids, step ids, statuses, files, or review findings for a targeted update.

## Creating durable plan state

- `workplan_create`: use when no matching plan exists and the task is non-trivial.
- Include `goal`, `scope`, `nonGoals`, `constraints`, `relevantFiles`, `specFiles` when known, phases, steps, validation, and `planFile`.
- Use stable readable ids. Do not create multiple plans for the same user request.
- Initial `planMarkdown` is acceptable for a fresh plan, but avoid sending large Markdown through future routine updates.

## Updating JSON metadata

- `workplan_update`: use for structured state:
  - title, goal, status
  - scope, non-goals, constraints
  - relevant files and spec files
  - phases and steps
  - review findings
  - notes
  - linked `planFile`
- Omit fields that should not change.
- Never pass blank strings for optional fields such as `planFile` or `planMarkdown`.
- If a frontend/tool schema displays blank optional placeholders anyway, treat them as omitted. Do not retry the same failing `workplan_update` call in a loop; use `workplan_patch` for Markdown-only changes, `workplan_reset` for explicit draft resets, or stop and report that the loaded workplan tool is stale.
- Prefer targeted `updatePhases`, `updateSteps`, `addPhases`, and `addSteps` over replacing the whole phase list when only one item changed.

## Updating Markdown prose

- `workplan_patch`: use for small localized edits to the linked Markdown plan.
- Use it for wording, rationale, sequencing detail, acceptance criteria, and handoff prose when JSON metadata does not need to change.
- Keep `patchText` minimal and target only the linked `.opencode/workplan/<id>.md` file.
- Do not use `workplan_patch` to change machine state such as phase status, step status, findings, scope, constraints, relevant files, or spec files. Those belong in `workplan_update`.

## Resetting and validating

- `workplan_reset`: use when a stale plan should restart from draft, or when Markdown should be regenerated from JSON metadata.
- `workplan_validate`: use after creating a plan, after major revisions, and before telling the user the plan is execution-ready.
- If validation fails, fix the plan or surface the blocker; do not hand off an invalid plan as ready.

# Planning handoff shape

When the plan is ready, respond with:

```text
Planning complete
<detailed brief summary of the plan>
- workplanId: <id>
- planFile: <path>
- status: ready | blocked | needs decision
- open questions: <none or exact questions>
- next step: use workflow-execute after PLANNING has been approved
```

# Stop rules

- Stop and ask the user when a scope, architecture, dependency, migration, or safety decision blocks planning. use the question tool to do so.
- Do not spin on more than 3 plan/review iterations without surfacing the blocker.
- If the user explicitly asks to execute, first state whether the workplan is valid and ready.

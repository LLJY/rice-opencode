---
name: workflow-plan
description: Create or revise a durable development plan when uncertainty, interacting components or multi-pass coordination warrants it. Used by plan and by the /dev development flow; planning never authorizes implementation by itself.
metadata:
  compatibility: opencode
  domain: software-engineering
  workflow: workplan-planning
---

# Planning procedure

1. Read the user's goal, applicable project instructions, existing changes, and relevant implementation/tests. Look for an existing matching plan before creating another. Use the actual project root, not a child cwd or this global configuration directory.
2. Separate facts discoverable in the repository from decisions only the user can make. Explore until the current question is answered; stop after two research waves add no useful evidence. Follow established conventions for routine reversible details and record assumptions. Ask about surviving material scope/product/architecture tradeoffs. Child planners return questions to their parent.
3. For a small, clear task, a concise in-message plan is enough. For non-trivial work, adopt one stable plan id and use the storage contract below. Record the existing authorization: plan-only, implementation requested, or a specific pending decision. A status field does not create approval.
4. Design coherent work packages with objective, owned files, dependencies, approach, acceptance criteria, validation and risks. Implementation plus its relevant tests belongs in one package. Plan parallel work only where file ownership and dependencies are clear. Do not prescribe a worker count or split cohesive reasoning into tiny tasks.
5. Verify references against current files. Use `plan-checker` on substantial plans; load `agent-use` before delegation. Apply evidence-backed corrections autonomously unless they introduce material scope creep, architecture changes, dependency changes, or user-facing tradeoffs. Keep those decisions with the user/parent.
6. Re-review only accepted blockers, introduced regressions and new evidenced material defects. Notes do not prevent readiness. Cap review at three cycles, then return the specific unresolved blocker or decision. A missing reviewer is a disclosed limitation, not a fabricated approval.
7. Return an execution-ready handoff or exact blockers. Do not implement or launch implementation workers in the planner. The parent build agent may continue an already authorized implementation request after the handoff; a direct plan-only request ends here.

# Durable storage

Keep `.opencode/workplan/<id>.json` for machine state and `.opencode/workplan/<id>.md` for detailed reasoning, ownership, acceptance and evidence. Optional specifications live under `.opencode/docs/specs/` and are linked via `specFiles`. Read [the artifact contract](references/workplan-contract.md) when creating, resuming or validating a durable plan.

Use `workplan_list`, `read` and `inspect` for discovery. If these tools are actually available, use `create`, `update`, `patch` and `validate` for maintenance. Never assume a tool exists merely because it appears in this skill. If absent in V2, use native read/edit tools and the same documented file format; preserve existing ids and fields. This fallback stays inside the planner's allowed artifact paths and requires no shell execution or plugin installation.

Before a fallback write, read `references/workplan-contract.md` relative to this skill's base directory. If that reference cannot be read, return BLOCKED with the error; do not infer a schema from logs, old conversations or another project's plan. New metadata must use numeric `schemaVersion: 2`, the documented field types and status enum. Re-read both artifacts and compare against that reference before claiming structural validity. Use the live session's canonical project directory for paths (on macOS `/tmp` may resolve to `/private/tmp`).

When tools are available:
- `workplan_update` changes JSON state: goal, scope, constraints, files, phases/steps, findings, notes and status. Prefer targeted `updatePhases`, `updateSteps`, `addPhases`, `addSteps`.
- Omit unchanged optional values. Never send blank strings or placeholder arrays to clear data. Do not retry a stale-schema error unchanged.
- `workplan_patch` changes localized Markdown prose only. Do not replace the whole plan on every update or use Markdown to silently change machine state.
- Use reset only for a requested restart; never reset a valid plan on resume.
- `workplan_validate` checks structure and linked files. Its `valid` result does not prove executability, authorization, or completion.

# Handoff

Return STATUS: READY | BLOCKED with a detailed brief summary of the plan, workspace root, workplan id, JSON and Markdown paths, scope, decisions/assumptions, work packages and ownership, acceptance/validation, plan-review coverage and remaining findings. READY is a handoff verdict, not a new JSON status enum. Include whether implementation was already requested or whether the user asked for a plan only. Do not ask for another generic approval when the parent already has implementation authorization.

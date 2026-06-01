---
name: workflow
description: Use for non-trivial software engineering work, durable workplans, multi-step implementation, plan/execute/review loops, scoped delegation, or parallel code-writer lanes.
compatibility: opencode
metadata:
  domain: software-engineering
  workflow: workplan
---

# How to use this skill

This compatibility skill is for non-trivial software-engineering work that needs
durable plan state, implementation discipline, validation, and review. For a
planning-only pass, prefer the more specific `workflow-plan` skill. For an
execution pass after planning is complete, prefer `workflow-execute`.

The model is not assumed to know the custom workplan tools. Use the tool guide
below as the operating contract.

# Workplan tool guide

- `workplan_list`: use first when resuming related work or when the user gives a vague plan name. Do not create a duplicate plan before checking whether one already exists.
- `workplan_create`: use when a non-trivial task needs durable state and no matching workplan exists. Capture goal, scope, non-goals, constraints, relevant files, phases, validation, and a linked Markdown `planFile`.
- `workplan_read`: use when you need the full JSON metadata plus linked Markdown plan content. Prefer this before execution handoff or when resuming after context loss.
- `workplan_inspect`: use when you only need stable phase ids, step ids, statuses, files, and findings for a targeted update. Prefer this over `workplan_read` when full Markdown would add noise.
- `workplan_update`: use for structured JSON metadata changes: goal, scope, non-goals, constraints, relevant files, spec files, phases, steps, review findings, notes, status, and linked `planFile`.
- `workplan_patch`: use for small localized edits to the linked Markdown plan when JSON metadata does not need structural changes. Keep `patchText` minimal and target only the linked `planFile`.
- `workplan_reset`: use when a stale or abandoned plan should return to draft state, or when the Markdown should be regenerated from JSON without manual prose patching.
- `workplan_validate`: use before execution, after major plan changes, and before declaring a workplan ready. Validation should pass or blockers should be surfaced clearly.

# Workplan update rules

- Never pass empty strings for optional `workplan_update` fields such as `planFile` or `planMarkdown`; omit unchanged optional fields instead.
- Avoid full `planMarkdown` in routine updates because tool-call inputs replay into future model context. Use structured fields or `workplan_patch` for small Markdown changes.
- Use `workplan_update` and `workplan_patch` together only when a change affects both JSON state and Markdown prose. Update JSON state first, patch prose second, then validate.
- Keep JSON metadata authoritative for machine state: phase status, step status, review findings, scope, constraints, relevant files, and spec files belong in `workplan_update`, not only in Markdown.

# Operating loop

1. Understand the user's requested outcome and constraints.
2. Inspect the workspace enough to know the relevant files, entry points, tests, and risks.
3. Create or adopt one persistent workplan for non-trivial work.
4. Keep the workplan current using the tool guide above.
5. Validate the workplan before execution; if validation fails, fix the plan or surface the blocker.
6. Execute in scoped passes with clear ownership, narrow validation, and review.
7. Record implementation progress, validation results, and review findings in the workplan.
8. Stop when validation passes and no blocker, critical, or major review findings remain.

# Delegation contract

Every non-trivial handoff to `@code-writer` should include all of the following unless a field is genuinely unknown:

- `workspaceRoot`: absolute workspace root path
- `cwd`: absolute working directory for the task when different from the workspace root
- `workplanId`: persistent workplan id when one exists
- `workplanPath`: absolute path to the JSON metadata when it helps avoid workspace-root mistakes
- `planFile`: absolute path to the Markdown execution plan when one exists
- `phaseId` and `stepId`: exact workplan phase/step to execute when applicable
- `specFiles`: architecture/specification files the child must follow for this pass
- `laneId`, `ownedFiles`, `blockedFiles`, `laneDependencies`, and `mergeOrder`: when parallel child lanes are used
- `goal`: one sentence describing the user-visible outcome for this pass
- `scope`: the exact files, routes, components, or systems allowed to change
- `nonGoals`: what must stay unchanged in this pass
- `constraints`: user constraints, dependency approvals, route stability requirements, or runtime constraints
- `inputs`: exact facts already established from the user, workplan, and local evidence
- `validation`: precise commands or smoke checks to run for this pass
- `deliverable`: what the child must return to the parent

Preferred handoff shape:

```text
Implementation contract
- workspaceRoot: /abs/path
- cwd: /abs/path
- workplanId: example-workplan
- workplanPath: /abs/path/.opencode/workplan/example-workplan.json
- planFile: /abs/path/.opencode/workplan/example-workplan.md
- phaseId: phase-x
- stepId: step-x-y
- specFiles: docs/specs/README.md, docs/specs/features/x.md
- laneId: lane-a
- ownedFiles: A and B only
- blockedFiles: C is owned by lane-b
- laneDependencies: wait for phase-y only if noted
- mergeOrder: lane-a then lane-b
- goal: Implement X without breaking Y.
- scope: Edit only A, B, and C.
- nonGoals: Do not change D or E.
- constraints: Keep route structure stable; approved deps are X and Y only.
- inputs: Existing workplan already exists; local AGENTS.md applies; current routes are ...
- validation: run cmd-1; smoke check route-1 and route-2
- deliverable: summary, files changed, validation results, blocker if any
```

Do not send a child agent off with only the user prompt when the task depends on workspace-specific state or an existing workplan.

# Parallelization policy

- Run a parallelization assessment by default after workplan validation.
- Parallelize only when tracks are independent, scopes are disjoint, and merge order is obvious.
- Good parallel examples: discovery in one lane while another lane reviews docs; route A and route B when they touch separate files; implementation in one lane and test planning in another.
- Bad parallel examples: two writers editing the same file set, two lanes deriving the same architecture, or any split that would require the child agents to guess ownership boundaries.
- Define candidate lanes, owned files, blocked/shared files, dependencies, merge order, and validation targets before launching parallel child work.
- If using parallel child work, define each lane's file ownership and validation target explicitly.
- After parallel lanes complete, reconcile their outputs in the parent, update the workplan once, then run the relevant validation and review loop.

# Decision rules
- Work directly only for very small changes where orchestration would be slower than execution.
- Prefer one active workplan per non-trivial task.
- For non-trivial work, create a workplan id early, keep it stable, and update it after each meaningful phase when you own the persistent handoff.
- If no workplan exists yet, derive one from the task goal, scope, constraints, likely files, and planned phases.
- If the user provides a workplan id, read that exact workplan from the current workspace root before doing anything else.
- Always treat the current project directory as the default `workspaceRoot`; if a workplan read fails, verify the root and list existing workplans before assuming none exist.
- Prefer `workplan_reset` when a stale or abandoned plan should be restarted instead of incrementally patched.
- After changing global tools, agents, skills, or config, remind the user to restart opencode so the changes load.
- After planning, validate the workplan first, then read the linked Markdown plan and any linked `specFiles`, then decide whether the execution can be parallelized safely before handing work to `@code-writer`.
- Before delegation, read any applicable local `AGENTS.md` and include relevant local commands or conventions in the handoff when they materially affect execution.
- Use a single `@code-writer` lane when dependency, file ownership, validation, or merge-order risk makes parallelism ambiguous; otherwise split into clear lanes.
- After each implementation or review pass, update the workplan with status, relevant files, open findings, and next steps.
- Mark review findings as open or resolved in the workplan instead of tracking them only in transient messages. When recording `@code-checker` severities, map `Critical -> critical`, `High -> major`, `Medium -> minor`, and `Low -> note` unless context warrants `blocker` or `question`.
- Keep fix loops narrow and evidence-based.
- If test scope is unclear or risky, narrow the validation contract before handing work off instead of guessing broad coverage.
- Stop the loop when validation passes and `@code-checker` has no unresolved blocker, critical, or major findings.

# Workplan policy
- Trivial tasks may stay in-message and skip persistent workplan creation.
- For implementation work, create or adopt a persistent workplan when the user requested one, when you are taking over a non-trivial blueprint/spec handoff, or when execution needs durable multi-pass coordination.
- The workplan should capture: goal, scope, non-goals, constraints, relevant files, the linked Markdown `planFile`, spec files when they exist, phases, validation, review findings, and current status.
- When resuming work, list or read existing workplans first instead of creating duplicates.
- Include the workplan id or path in major handoffs when it helps subagents stay aligned.

# Stop rules
- Do not run more than 3 implementation/review cycles without either converging or surfacing a blocker.
- If the same issue repeats without progress, stop and explain the blocker.

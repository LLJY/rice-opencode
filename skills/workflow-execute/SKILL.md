---
name: workflow-execute
description: Use after PLANNING has been completed, approved and a workplan exists. To execute an existing workplan through implementation, validation, and review. Do not load unless the user says "use workflows"
compatibility: opencode
metadata:
  domain: software-engineering
  workflow: workplan-execution
---

# Goal

Execute an approved workplan through scoped implementation, validation, and
review while keeping workplan state current.

# Preconditions

- PLANNING has been completed or the user explicitly accepts executing with a partial plan.
- A workplan id or clear plan file is available, unless the task is trivial enough to skip durable planning.
- The requested execution scope is clear enough to avoid guessing.

# Execution methodology

1. Read or adopt the workplan.
2. Validate the workplan before changing implementation files.
3. Read the linked Markdown plan and any linked `specFiles`.
4. Identify the next executable phase/step and its file ownership boundaries.
5. Decide whether work can be done directly or should be delegated to `@code-writer`.
6. Run the narrowest useful validation after each implementation pass.
7. Use `@code-checker` for meaningful changes.
8. Record progress, validation, and review findings in the workplan.
9. Loop only on concrete review findings; stop when validation passes and no blocker/critical/major findings remain.

# Workplan tool subset for execution

## Readiness and context

- `workplan_read`: use at the start of execution to load full JSON metadata and linked Markdown plan detail.
- `workplan_inspect`: use before targeted phase/step status updates, review-finding updates, or handoffs that need exact ids.
- `workplan_validate`: use before implementation, after major workplan changes, and before declaring completion.

## Execution state updates

- `workplan_update`: use for machine-readable progress:
  - mark phases/steps `in_progress`, `review`, `completed`, or `blocked`
  - add relevant files discovered during execution
  - append validation notes
  - add review findings from `@code-checker`
  - mark findings resolved after a fix pass
- Omit unchanged optional fields. Never pass blank strings for `planFile`, `planMarkdown`, or other optional values.
- Do not use full `planMarkdown` for routine progress updates.

## Markdown execution notes

- `workplan_patch`: use only for small localized updates to linked Markdown plan prose, such as completion notes, clarified acceptance criteria, or refined handoff detail.
- Keep `patchText` minimal.
- Do not use `workplan_patch` as a substitute for JSON status, findings, relevant files, or phase/step state.

## Recovery and stale plans

- `workplan_list`: use if the provided plan id is missing or ambiguous.
- `workplan_reset`: use only when the user wants to restart a stale plan or regenerate Markdown from JSON metadata before execution.
- `workplan_create`: normally not used in execution. If no workplan exists for non-trivial work, pause and create/validate one only if the user accepts that planning is incomplete.

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
Tell it to "use workflows execute skill" so it loads the appropriate skill.

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
- If the user provides a workplan id, read that exact workplan from the current workspace root before doing anything else.
- Always treat the current project directory as the default `workspaceRoot`; if a workplan read fails, verify the root and list existing workplans before assuming none exists.
- Before delegation, read applicable local `AGENTS.md` and include relevant local commands or conventions in the handoff when they materially affect execution.
- Use a single `@code-writer` lane when dependency, file ownership, validation, or merge-order risk makes parallelism ambiguous; otherwise split into clear lanes.
- After each implementation or review pass, update the workplan with status, relevant files, open findings, and next steps.
- Mark review findings as open or resolved in the workplan instead of tracking them only in transient messages. When recording `@code-checker` severities, map `Critical -> critical`, `High -> major`, `Medium -> minor`, and `Low -> note` unless context warrants `blocker` or `question`.
- Keep fix loops narrow and evidence-based.
- If test scope is unclear or risky, narrow the validation contract before handing work off instead of guessing broad coverage.
- Stop the loop when validation passes and `@code-checker` has no unresolved blocker, critical, or major findings.

# Stop rules

- Do not run more than 3 implementation/review cycles without either converging or surfacing a blocker.
- If the same issue repeats without progress, stop and explain the blocker.
- After changing global tools, agents, skills, or config, remind the user to restart opencode so the changes load.

---
name: workflow-execute
description: Execute a ready development workplan through scoped implementation, evidence-backed validation and independent review. Used for authorized implementation, including /dev; honor plan-only requests.
metadata:
  compatibility: opencode
  domain: software-engineering
  workflow: workplan-execution
---

# Preconditions

Read the exact plan from the actual project root, including JSON state, linked Markdown and specFiles. Confirm readiness and the user's existing implementation authorization. An implementation request or `/dev` authorizes ordinary in-scope work; a plan-only request does not. Do not request a redundant approval between ready steps.

If a non-trivial task has no plan, use `workflow-plan` first under the same implementation authorization. The planner returns the plan; build retains execution ownership. For small clear changes, skip durable planning.

Read [the artifact and evidence contract](../workflow-plan/references/workplan-contract.md) for state, receipts and the three gates. If workplan tools are unavailable, use native read/edit tools on the same artifacts. Never stall in a retry loop over nonexistent or stale tools.

If the artifact contract cannot be read, report that blocker rather than guessing field names or accepting an unknown schema. Numeric `schemaVersion: 2` and the documented field types/statuses are required for the native-file fallback. Use the live session's canonical project root, not a filesystem alias that resolves outside it.

For this global harness, when `workplan_validate` is absent, build can run the read-only structural check with `bun ~/.config/opencode/scripts/check-workplan.ts <absolute-workspace-root> <workplan-id>` after the planner returns. It checks the existing schema and linked files without installing anything. A nonzero exit blocks structural validity. If Bun or this helper is unavailable, disclose that limitation and validate with native reads against the artifact contract; do not claim the command ran. Planner and reviewer agents have shell disabled and return their artifacts/findings to build for this check.

# Execution loop

1. Check structural validity and codebase readiness. If a substantial plan has not been vetted by `plan-checker`, request that review. Apply recommended corrections autonomously unless they introduce material scope creep, architecture changes, dependency changes, or user-facing tradeoffs; surface those decisions.
2. Read exact phase/step IDs before updates. Identify the next executable package, prerequisites, owned files, blocked/shared files, integration order and validation target. Recheck stale references when the code changed.
3. Load `agent-use`. Delegate bounded engineering to `code-writer` or `frontend-engineer`, retaining Sol for decisions and integration. Work directly for a small task or when one coherent reasoning context is needed. Delegate only independent meaningful slices with disjoint ownership. Serialize shared-file work.
4. Require the worker to run relevant self-checks and return the standard receipt. The parent reconciles outputs, inspects the diff and updates shared state once. Workers do not edit the shared workplan.
5. Use `tester` for additional specified checks, bug reproduction or collecting high-volume test evidence when that saves work. Reuse already valid checks for the same code state instead of automatically running them again. A tester reports failures; the implementer fixes them.
6. For medium/large or consequential changes, obtain a fresh `code-checker` review with exact scope, acceptance criteria, current diff and evidence. Use code-checker for slice-wide audits; for small changes, wait until the end of a larger slice before review. Reviewers do not repair the implementation. Track findings durably and return concrete corrections to the appropriate worker.
7. After each meaningful pass, record code state, worker/session id, attempts, changed files, acceptance evidence, validation commands/results, findings and next step. Update the JSON statuses and Markdown detail with localized edits.
8. Continue the next ready package without generic permission questions. Stop when the completion gate passes or a concrete blocker/decision requires input.

# State updates

Prefer one active workplan per task. Use `workplan_read`/`inspect` before targeted updates when available. `workplan_update` owns JSON fields; `workplan_patch` owns localized Markdown prose. Omit unchanged optional fields and never send empty placeholder strings or full planMarkdown for routine updates. If tools are absent, edit the same version-2 JSON and Markdown directly; preserve ids, markers and unrelated state.

Record review severities as `blocker`, `critical`, `major`, `minor`, `note`, `question`; map legacy Critical -> critical, High -> major, Medium -> minor, Low -> note. Mark resolved findings explicitly. Do not confuse structural `valid` with verified completion. Preserve failed attempt history and the current resume point across compaction.

# Convergence and acceptance

After two failed substantive fixes, reassess the hypothesis with Sol; consult oracle for contradictory evidence or exceptional uncertainty. Resume the worker for a specific correction when native continuation is available. Do not continue the same agent more than once (total 2 invocations); for smaller fixes you may continue up to 3 times. Stop after three non-converging implementation/review cycles and report remaining evidence and the decision needed. Do not repeat an unchanged failing approach or broaden scope to appease speculative review suggestions.

Before marking completed, check the original user outcome, current acceptance evidence, required validation, integration across slices, and absence of unresolved blocker/critical/major findings. An independently reviewed significant change may pass with non-blocking notes. If required verification is unavailable, report that limitation; never invent a passing check.

Finish with behavior delivered, relevant files, checks/evidence and remaining limitations. After global harness changes, explain whether a new session or service restart is needed to load them; do not interrupt unrelated running work automatically.

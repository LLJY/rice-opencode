---
description: Clean up AI-generated slop while preserving behavior
agent: build
---

Remove AI-generated slop from the target without changing behavior.

Target: $ARGUMENTS (if empty, ask which files to clean).

## Scope

- This command is a behavior-preserving cleanup workflow (verbose comments, dead code, generic filler, over-defensive guards).
- Boundary: `commands/review.md` is the adversarial diff review (finds bugs/risks in latest changes); this command fixes no bugs and reviews nothing — it only cleans known slop in explicitly scoped files.

## Behavior lock

1. Establish the behavior baseline first: run the existing regression tests green before editing.
2. If coverage is thin, add or propose minimal characterization tests before cleanup.

## Slop categories

Remove only these: stale/WHAT-comments, dead or commented-out code, unused imports/vars, duplicated boilerplate, generic filler prose, over-mocked test scaffolding, redundant logging, over-defensive nil/type guards with no caller, inconsistent naming introduced by generation.

## Quality gates

- Never touch files outside the stated scope.
- After cleanup: tests still green, LSP diagnostics clean, diff minimal and behavior-identical.
- If a cleanup would change behavior, stop and surface it instead of proceeding.

## Output

Report files cleaned, what was removed per category, and verification evidence.

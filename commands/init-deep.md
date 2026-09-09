---
description: Generate hierarchical AGENTS.md files from repository structure
agent: build
---

Generate hierarchical AGENTS.md files that describe repository structure for future agents.

Scope: $ARGUMENTS (if empty, cover the repository root; otherwise limit to the given subtree).

## Scope

- This command generates repo-structure guidance (layout, conventions, where things live).
- Boundary: `commands/recall-distill.md` mines session lessons from past work into AGENTS.md memory blocks; this command uses no session history — it derives guidance from the live repo structure only.

## Workflow

1. Discovery: delegate `explore` subagents per top-level area (plus LSP/structural search where useful) to map layout, entry points, conventions, and test/build commands. Run areas concurrently when scopes do not overlap.
2. Scoring: decide AGENTS.md placement per directory — root always; large or distinct-domain subdirs (>~15 files or a distinct module) get their own; small homogeneous dirs (<~8 files) skip and inherit from the parent.
3. Generation: write root AGENTS.md first (global layout, build/test commands, top conventions), then subdir files with local specifics only (no repetition of the root).
4. Dedupe: re-read generated files, remove overlap, keep each file focused and short.

## Constraints

- Describe the repo as it is; do not invent conventions.
- Keep each AGENTS.md scannable (bullets, exact paths, real commands).
- Do not commit unless asked.

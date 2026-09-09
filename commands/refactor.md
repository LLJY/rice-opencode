---
description: Refactor code safely with intent gate, structural search, and test coverage
agent: build
---

Refactor the requested code with safety gates, not blind rewrites.

Target: $ARGUMENTS (if empty, ask which files or behavior to refactor).

## Intent gate

- State the refactor intent (what behavior must NOT change) before touching code.
- If the intent is ambiguous, stop and ask rather than guessing.

## Workflow

1. Explore in parallel: delegate one `explore` subagent for usage/callers and use LSP diagnostics plus structural search (ast-grep skill when available) to map the affected surface.
2. Build a short codemap: files, entry points, callers, tests covering the area.
3. Test-coverage gate: if coverage of the target is LOW, propose or add regression tests first and get them green before refactoring.
4. Plan the refactor as small ordered steps (each step independently verifiable).
5. Implement step by step: after each step, run LSP diagnostics and the relevant tests; fix before proceeding.
6. Keep diffs minimal; do not change behavior, APIs, or unrelated files.

## Constraints

- Do not expand scope beyond the stated target.
- Prefer explicit, readable code over clever abstractions.
- Report: what changed, tests run with results, and any behavior risk remaining.

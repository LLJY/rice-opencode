---
description: Emit a structured session handoff summary for continuation
agent: build
---

Write a structured handoff summary so another session can continue this work without re-discovery.

Focus: $ARGUMENTS (if empty, cover the whole current session).

<!-- provenance: features.md fallback — no upstream handoff template file exists; shaped from features.md /handoff purpose text -->

## Handoff

### State

- Current goal and where things stand (1-3 sentences).

### Done

- Completed steps with evidence (files changed, tests green, commands run).

### Remaining

- Ordered list of unfinished steps; mark the immediate next action.

### Paths

- Key files/dirs (exact repo-relative paths).
- Relevant session IDs, branch, or issue links (if any).

### Decisions and open questions

- Choices made and why; anything still needing a user call.

## Constraints

- Summarize from actual session evidence; do not invent completed work.
- Keep it scannable; prefer bullets over prose.

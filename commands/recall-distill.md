---
description: Distill per-project lessons from past sessions into AGENTS.md memory blocks
agent: build
---

Distill durable "lessons learned" from the user's past opencode sessions into per-project memory files, using the recall tools.

## Scope

- If `$ARGUMENTS` is non-empty, treat it as a project filter (substring of the project directory) and distill only matching projects.
- Otherwise, call `recall_projects` and pick the 3 most recently active real projects (skip `unknown` and the user's home directory pseudo-project unless explicitly requested).

## Per-project workflow

1. Run several themed `recall_search` queries with `project` set, e.g.:
   - "bug root cause fix"
   - "decision chose because trade-off"
   - "gotcha workaround pitfall"
   - "failed approach didn't work reverted"
   - "convention pattern structure"
   Vary phrasing based on what the project is about.
2. For the 2–3 highest-signal sessions surfaced, call `recall_session` to read them in full.
3. Synthesize **5–15 durable lessons**. Each lesson must be:
   - imperative and specific ("Use X because Y", "Never do Z — it causes W")
   - useful to a future session, not narration of what happened
   - free of session ids, dates, or transient state
4. Write the lessons into `<project dir>/AGENTS.md` inside a managed block:

   ```
   <!-- recall:lessons:begin -->
   ## Lessons from past sessions
   - ...
   <!-- recall:lessons:end -->
   ```

   - If the file doesn't exist, create it with just this block.
   - If the file exists without the block, append the block.
   - If the block exists, replace only its contents (merge: keep still-valid old lessons, drop obsolete ones).
5. **Show the user the diff before writing each file** and ask for confirmation.

## Global lessons

Cross-project lessons (user preferences, general workflows) belong in `~/.config/opencode/AGENTS.md` in the same managed block. Always get explicit confirmation before touching anything under `~/.config/opencode`.

## Constraints

- Do not commit.
- Do not write anywhere except the managed blocks described above.
- Keep each project's block under ~40 lines.

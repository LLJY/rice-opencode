---
name: git-commit
description: Use when preparing Git commits; check repository convention first, prefer Conventional Commits, keep commits granular, and handle branch safety without blocking explicit user intent.
compatibility: opencode
metadata:
  domain: git
  workflow: commits
---

## What I do

Use this skill when the user asks to create, prepare, review, or phrase a Git commit.

## Commit rules

1. **Do not commit unless the user explicitly asks.**
2. **Check repository convention first.** Inspect recent commit messages before drafting a message. Repository convention takes precedence over the defaults below.
3. **Default to Conventional Commits** unless the repository clearly uses another convention.
   - Use types such as `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`, or `style`.
   - Use a module/scope when applicable: `feat(auth)`, `fix(api)`, `chore(deps)`.
4. **Keep the title short and descriptive.** Prefer one focused line that explains the change.
5. **Always include a very brief summary below the title** unless repository convention clearly forbids commit bodies.
6. **Keep commits as granular as reasonably possible.** Do not mix unrelated work into one commit.

## Branching rules

1. Never create a new branch unless the user instructs you to.
2. If the user is committing directly on `main` or `master`, warn them if it appears to be a shared branch.
3. Do not impede the user if their intention is to commit on that branch anyway.

## Staging discipline

- Review `git status`, staged/unstaged diff, and recent commit style before committing.
- Stage only files relevant to the requested commit.
- Do not stage likely secrets or local-only artifacts.
- If unrelated working-tree changes exist, leave them untouched and mention them.

## Message shape

```text
<type>(<scope>): <short description>

<one short sentence summarizing why this commit exists>
```

Examples:

```text
feat(memory): add conservative opencode-mem defaults

Configures project-local memory behavior without enabling automatic capture.
```

```text
fix(docs): correct citation backend selection

Ensures IEEE presets use the BibTeX path while report presets use citeproc.
```

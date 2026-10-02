---
description: Perform an adversarial review of latest repository changes
agent: build
---

Perform an adversarial review of all latest changes in this repository.

## Scope

- Focus on the latest Git diffs: staged changes, unstaged tracked changes, and relevant untracked source/config/docs files.
- Start by inspecting `git status --short --branch`, `git diff --stat`, `git diff`, and `git diff --cached`.
- If untracked files are present, review only files that appear relevant to source/config/docs changes. Mention generated, binary, or unrelated artifacts separately instead of reading them exhaustively.
- If there are no reviewable changes, say so and stop.

## Delegation workflow

1. If the diff is small enough for one focused review, delegate one review to `code-checker`.
2. If the diff is large or spans unrelated components, split it into non-overlapping slices by package, module, or file group.
3. Launch one `code-checker` subagent per slice, preferably in parallel when scopes do not overlap.
4. Copy the subagent instruction block below into every `code-checker` prompt, adding the exact files and scope for that slice.
5. After subagents return, synthesize the findings, deduplicate overlaps, and prioritize by severity.

## Constraints

- Do not modify files.
- Do not commit.
- Do not create branches.
- Do not review unrelated historical code unless needed to understand the diff.
- Prefer concrete file/line findings over vague advice.

## Subagent instruction block

Copy this into each `code-checker` prompt and fill in the bracketed scope details:

```markdown
## Role

You are a code verification specialist. Another AI agent wrote this. Your task is to conduct an adversarial review.

## Prerequisites

- Repository root: [repo root]
- Review scope: [specific package/module/file group]
- Files/resources to inspect:
  - [exact paths]
- Relevant diff context:
  - [summarize or point to exact diff/files]

## Task

Review only the assigned scope. Find correctness bugs, spec mismatches, risky behavior, missing edge cases, security issues, broken tests, config mistakes, and maintainability problems introduced by the latest changes.

## Constraints

- Do not modify files.
- Do not review outside the assigned scope unless required to understand a caller/callee relationship.
- Prefer actionable findings with file paths and line references.
- If the assigned slice looks sound, say that clearly and mention what you checked.

## Output

Return findings grouped by severity: Critical, High, Medium, Low. Include a short summary and any verification commands you recommend or ran.
```

## Final response format

Return:

1. Overall verdict
2. Critical/high findings first
3. Medium/low findings
4. Review coverage, including which slices/subagents were used
5. Suggested verification commands

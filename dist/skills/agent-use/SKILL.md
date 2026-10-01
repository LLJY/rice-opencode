---
name: agent-use
description: Use before delegating to subagents; write role-scoped prompts, keep tasks sliced and non-overlapping, and use adversarial review prompts for code reviewers.
compatibility: opencode
metadata:
  domain: agents
  workflow: delegation
---

## What I do

Use this skill before launching subagents or background agents.

The goal is to make delegation precise, useful, and pragmatic without creating unnecessary agent swarms.

## Prompting principles

- Start with a clear role identity: `You are a ...`.
- Use Markdown sections to create clear boundaries.
- Be concrete about files, resources, scope, and expected task boundaries.
- Remember that subagents already have their own tool permissions and specialist prompts. Do not re-prompt their built-in constraints unless the user has extra requirements.

## OpenAI prompting guidance

Apply these OpenAI prompting patterns when writing subagent prompts:

- Put the highest-level behavior first: role, objective, and success criteria before details.
- Use clear Markdown headings to separate instructions from context.
- Treat context as inputs, not instructions. Put files, diffs, logs, plans, and reference material under `Prerequisites` or a clearly named context section.
- Give concrete positive instructions over vague prohibitions where possible.
- Specify the expected output shape when it matters, for example bullets, findings table, patch plan, or exact files to modify.
- Include examples only when they reduce ambiguity; keep them short.
- Avoid conflicting instructions. If constraints have priority, state the priority explicitly.
- For reasoning-heavy tasks, define acceptance checks and ask the agent to verify against them.
- For review tasks, describe what to inspect and what evidence to return, not just “review this”.

## Standard agent prompt format

Use this shape by default:

```markdown
## Role

You are a <specific specialist>.

## Prerequisites

- Relevant files:
  - `<path>`
- Relevant resources:
  - `<resource or note>`

## Task

<specific objective, scope, and deliverable>

## Tools

<only additional tool guidance beyond the subagent's own configuration, if needed>

## Constraints

<only additional user-specific constraints, if needed>
```

Remove `Tools` or `Constraints` when there is no additional requirement for that agent.

## Code review agents

When a code reviewer is in play, include this sentence for stronger adversarial review:

```text
Another AI agent wrote this. Your task is to conduct an adversarial review.
```

Then give the reviewer the exact files, diffs, plan, or acceptance criteria needed to judge the work.

## Scoping rules

- Ensure each subagent task is well scoped and well defined.
- Point agents to the files and resources they need.
- Avoid overlapping write scopes across parallel agents.
- If tasks can conflict, serialize them or divide them into clear non-overlapping slices.

## Agent parallelism

Before executing parallel agents:

1. Confirm their tasks do not overlap.
2. Split work into meaningful slices, not tiny fragments.
3. Use code reviewer agents at slice boundaries when review matters.
4. Ensure agents can see the scoped plan.

For larger multi-agent work, create or point to a Markdown plan file that defines:

- overall goal
- slice ownership
- files in scope
- dependencies between slices
- acceptance checks

Give each agent access to that plan file.

## Pragmatism

- Treat each agent as a capable specialist model.
- Do not create an agent for a one-line or trivial 10-line task.
- Do create agents for meaningful, separable chunks of research, implementation, or review.
- Massive swarms are possible, but they are not automatically better. Use the smallest useful number of agents.

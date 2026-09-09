---
description: Develop a feature or fix with automatic planning, scoped implementation, validation and review
agent: build
model: openai/gpt-5.6-sol#medium
subagent: false
---

Handle this development request end to end using your development routing:

$ARGUMENTS

Inspect the repository first. Use direct implementation for small clear work; delegate bounded engineering to code-writer or frontend-engineer. When architecture, uncertainty, or coordination warrants a plan, call the plan agent, then execute the ready plan under the existing user authorization. This command opts into workflow-plan and workflow-execute when useful. Respect explicit research-only, review-only and plan-only wording. Keep user decisions and publishing actions within their actual authorization. Verify the outcome and report evidence.

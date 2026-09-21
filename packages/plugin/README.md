# @rice-opencode/plugin

Batteries-included workflow support for [OpenCode](https://opencode.ai):

- eight durable `workplan_*` tools;
- bundled `workflow-plan` and `workflow-execute` skills;
- an additive compaction hook that preserves active workflow status and tells the next context which workflow skill to load.

The plugin preserves OpenCode's default compaction prompt. It only appends a conditional workflow-status contract to the compaction user message.

## Install

After publication, add the package to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@rice-opencode/plugin"]
}
```

OpenCode installs npm plugins automatically at startup. Restart OpenCode after adding or upgrading the package.

For development from this repository:

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run build
bun run pack:check
```

## Included tools

- `workplan_create`
- `workplan_inspect`
- `workplan_list`
- `workplan_patch`
- `workplan_read`
- `workplan_reset`
- `workplan_update`
- `workplan_validate`

Workplans live under the active workspace's `.opencode/workplan/` directory.

## Compaction behavior

When a workplan is actively being planned or executed, summaries gain:

```markdown
### Workflow Status
- Mode: workflow-plan | workflow-execute
- Workplan path: [exact path]
- Current step: [exact current step and status]
- Plan-checker ran: yes | no
- Continuation requirement: [mode-specific skill-loading instruction]
```

Completed, cancelled, old, proposed, or merely discussed workplans must not trigger the section.

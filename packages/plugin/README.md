# @rice-opencode/plugin

One native [OpenCode V2](https://opencode.ai/v2/) plugin containing:

- **9 tools**: eight durable `workplan_*` tools and `viz_generate_image`;
- **6 skills**, including their complete supporting files;
- **10 active agents**, with our original prompts, model IDs, and variants;
- the existing **`/review` command**.

The package does **not** ship our OpenCode JSON, provider/auth/MCP setup, secrets,
deprecated agent alias, V1 SDK/entrypoints, or compaction hooks. It does not change
the host's global default-agent selection. Requires OpenCode V2; checked against
SDK **2.0.20**.

## Install

Add the versioned GitHub package to the host's existing native V2 `plugins` list:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:LLJY/rice-opencode#v0.1.0",
      "options": { "trustedWorkspaceWrites": true }
    }
  ]
}
```

Add this **one entry** to the host's existing `plugins` list; do not replace its
config with this repository's JSON. No npm account, registry login or GitHub
token is required for the public Git target. The `v0.1.0` tag contains the built
package at its root; source development stays on `v2`. There is no npm release.

For a local checkout, run `bun install --frozen-lockfile` and `bun run build`,
then use the checkout's absolute `packages/plugin` path as `package` (or
`./packages/plugin` when the host config lives at the repo root). The package
default, `./server`, and `./v2` all resolve to the same native entrypoint.
Quit and restart OpenCode after activation or upgrade.

## Agents and host compatibility

Bundled agents: `build`, `chat`, `code-checker`, `code-writer`,
`document-proofreader`, `explore`, `plan`, `plan-checker`, `researcher`, and `swe`.
The disabled `docs-first-coder` alias is not included.

Matching agents are intentionally updated with our prompts, models/variants,
mode and request settings; stale optional settings are cleared. Unrelated agents
and the global default selection stay untouched. The host must already provide
and authenticate the model IDs these agents reference; the plugin does not
install providers or silently substitute models. `swe` has no pinned model and
uses normal host model selection.

Existing permission lists are retained and our declared overrides appended;
the last matching rule wins and unmatched old rules remain. Existing same-name
skills retain precedence. `/review` intentionally switches its invoking session
to `build` and its configured model, then submits the original review prompt and arguments there,
preserving attachments and delivery. It does not change the global default.

## Workspace-only writes

Without `trustedWorkspaceWrites: true`, read tools still work but create, update,
reset, patch and image generation are rejected. Writes stay within the calling
session's workspace
and preserve the linked-plan, symlink and overwrite checks. This policy does not
evaluate per-file `edit` allow/ask/deny rules or show V1 approval prompts; it is
an explicit trust decision for workplan maintenance. V2 can still hide mutators
when the entire `edit` action is denied.

Image generation uses the existing `VIZ_OPENAI_*` / `OPENAI_*` environment
settings or `providers.openai.settings`. Defaults remain the local Responses
endpoint `http://127.0.0.1:2455/v1` and model `gpt-5.5`; configure an image-capable
endpoint if the host does not run that proxy. OpenCode OAuth is not converted
into an image API key automatically.

The prompts still refer to their existing external research/MCP tools. Configure
those separately in the host; including this plugin does not install them.

## Development and standalone verification

From the repository root:

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run build
bun run v2:check
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
- `viz_generate_image`

Workplans live under the active workspace's `.opencode/workplan/` directory.

## Included skills

`agent-use`, `frontend-design`, `git-commit`, `shell-strategy`, `workflow-execute`,
and `workflow-plan`.

`pack:check` installs the archive in a clean room and activates it in a fresh
Bun process without the repository or Core dev dependency. It checks all
9/6/10/+1 registrations, full asset copies, agent replacement, model assignments,
workspace patching, cancellation, `/review` forwarding, and absence of configs,
secrets and V1 code. No provider requests or live OpenCode service are started.

## License and source

The plugin is GPL-2.0-only, matching the repository license. Original license
notices for bundled Zod and skill sidecars are retained. The GitHub release
provides the built download, corresponding source archive, exact bundled Zod
source archive, and checksums. To rebuild from the source archive, run
`bun install --frozen-lockfile && bun run build` at its root; use the package's
`dist/` output. GitHub's automatic archive of the artifact tag is the built
package, not the development source snapshot.

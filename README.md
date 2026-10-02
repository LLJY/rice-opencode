# @rice-opencode/plugin

One native [OpenCode V2](https://opencode.ai/v2/) plugin containing:

- **9 tools**: eight durable `workplan_*` tools and `viz_generate_image`;
- **6 skills**, including their complete supporting files;
- **10 active agents**, with our original prompts, model IDs, and variants;
- the existing **`/review` command**.

The package does **not** ship our OpenCode JSON, provider/auth setup, secrets,
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
      "package": "github:LLJY/rice-opencode#v0.2.0",
      "options": { "trustedWorkspaceWrites": true }
    }
  ]
}
```

Add this **one entry** to the host's existing `plugins` list; do not replace its
config with this repository's JSON. No npm account, registry login or GitHub
token is required for the public Git target. The `v0.2.0` tag contains the built
package at its root; source development stays on `v2`. There is no npm release.

For a local checkout, initialize the submodules, run `bun install --frozen-lockfile`
and `bun run build` (requires Go 1.25+ and uv),
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

## Automatic research MCPs — v0.2.0

Added in v0.2.0; v0.1.0 remains available without automatic MCP integration.
No host JSON is bundled or rewritten.

The plugin registers absent `researcher-mcp`, `hound`, and `exa` servers through
OpenCode's native MCP API. OpenCode starts/connects the enabled servers and owns
their teardown. Both local upstreams are Git submodules pinned to exact commits;
the package includes their runtime sources and notices, so installed users do not
need Git or submodule initialization.

- **Researcher:** packaged Go binaries for Linux/macOS/Windows x64 and arm64;
  source pinned to `61106bcc107074566562d8c0e24c50c938785d96`. No Go installation
  is needed by plugin users. Scholarly endpoints can still rate-limit/block calls;
  this upstream does not consume all provider keys advertised in its README.
- **Hound:** source pinned to v12.4.1 (`1dab81b7fc03721688cfb7775fc1222c7f9805ba`).
  Requires `uv` on PATH. On first activation, a background task prepares locked
  Python 3.12 dependencies in the user's cache, enables the MCP, then attempts
  Chromium installation. It does not install system packages or delay ordinary
  tools behind the MCP handshake. Browser failure leaves HTTP fetching available;
  unsupported Python wheels leave Hound unavailable with a warning. Browser OS
  libraries must already be installed. Warm activations reuse verified caches.
- **Exa:** default general-search MCP for our agents. Set `EXA_API_KEY` in the
  environment that launches OpenCode, or place the key in the existing
  `~/.config/opencode/.exa-api-key` file. The environment wins. Only
  `web_search_exa` is requested; the key is sent in `x-api-key`, never a URL.
  A missing/blank/unreadable key warns and leaves Exa unregistered—no anonymous
  mode or automatic search fallback. Other features continue running.

Our agents deny `hound_*smart_search` while retaining Hound fetch/crawl and
Researcher's scholarly search. Prompts, unrelated host agents and other host
search tools are unchanged. Other referenced MCP integrations remain host-owned.

**Existing host entries win, including disabled entries.** If your host already
defines these names, remove those definitions yourself to activate the managed
versions. The repo's personal `opencode.v2.json` currently defines all three, so
using it unchanged does not switch them over.

Plugin options: `mcp: false` disables this entire integration and its search deny;
`mcpCacheDirectory` chooses an absolute writable cache base; `exaApiKeyFile`
selects an alternate key file. Cache directories are keyed by lock, manifest,
source revision and platform, and startup never modifies the installed package.
Restart OpenCode after adding the key or changing these options.

## Development and standalone verification

From the repository root:

```bash
git submodule update --init --recursive
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run build
bun run v2:check
bun run pack:check
bun run mcp:check
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
MCP activation is opted out in that pure preset check; packaged MCP binaries,
sources, lock and licenses are still validated. `mcp:check` separately provisions
an isolated `/tmp/opencode` cache and performs real stdio handshakes/catalog
listing for both local servers. It downloads dependencies/browser, but makes no
paid Exa calls, research searches or model requests. Pass an absolute relocated
bundle with `bun run scripts/check-mcp.ts --dist /absolute/package/dist`.

## License and source

The plugin is GPL-2.0-only, matching the repository license. Original license
notices for bundled Zod, Go dependencies and skill sidecars are retained. The
GitHub release provides the built download, corresponding source archive with
both pinned submodule trees, exact bundled Zod source archive, and checksums.
For a reproducible rebuild, clone the repository, check out the source commit
recorded in the release's SOURCE.md, initialize submodules, then run
`bun install --frozen-lockfile && bun run build` with Go 1.25+ and uv available.
GitHub's automatic archive of the artifact tag is the built package, not the
development source snapshot.

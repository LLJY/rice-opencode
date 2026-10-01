# rice-opencode

[OpenCode V2](https://opencode.ai/v2/) plug-and-play preset — tools, skills, agents, and `/review` in one plugin.

## Overview

`packages/plugin` is the distributable V2-only bundle. Install one plugin entry
into an existing OpenCode setup; do not copy our JSON config. The repository also
retains personal config examples and document templates, which are not packaged.

## Features

### Specialized Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `plan` | `openai/gpt-6-astra#high` | Requirements analysis and execution planning |
| `swe` | Host-selected | Software engineering orchestrator for multi-step code work |
| `chat` | `openai/gpt-5.5#high` | General interactive agent |
| `build` | `openai/gpt-6-astra#high` | High-agency implementation and verification |
| `explore` | `openai/gpt-6-luna#high` | Fast codebase navigation and file discovery |
| `researcher` | `openai/gpt-6-sol#xhigh` | Literature-review research with optional read-only codebase context |
| `plan-checker` | `openai/gpt-6-sol#xhigh` | Workplan, spec, handoff, and workflow risk review |
| `code-writer` | `openai/gpt-6-luna#max` | Documentation-first focused implementation subagent for scoped plan steps |
| `code-checker` | `openai/gpt-6-sol#xhigh` | Code review, smells detection, and verification |
| `document-proofreader` | `openai/gpt-6-sol#xhigh` | Academic proofreading and argument review |

### Batteries-included workflow plugin

`packages/plugin` supplies **9 tools, 6 skills, 10 active agents and `/review`**.
Source prompts and model assignments are unchanged. No root JSON, provider/MCP
configuration, V1 SDK/entrypoints or compaction hooks are shipped. See
[`packages/plugin/README.md`](packages/plugin/README.md) for the single-entry install.

### SWE Workplan Baseline

This repo now includes a software-engineering baseline with durable workplan tools and agent prompts for structured multi-step execution.

Available workplan tools:

- `workplan_create` — create a persistent workplan under `.opencode/workplan/`
- `workplan_inspect` — list stable phase/step ids for targeted updates
- `workplan_list` / `workplan_read` — discover and inspect existing workplans
- `workplan_update` — patch phases, steps, files, findings, and notes
- `workplan_patch` — apply a restricted patch to the linked Markdown plan
- `workplan_reset` — reset a stale plan or regenerate its markdown
- `workplan_validate` — validate JSON metadata, linked markdown, and spec files

### Personal MCP config examples — not part of the plugin

- **GitHub Copilot** — Code search and repository intelligence
- **DeepWiki** — Repository documentation and structure analysis
- **Context7** — Library documentation queries
- **Exa** — Primary open-web search through the native remote MCP
- **Hound** — Local webpage, PDF, and crawl retrieval with browser fallback
- **DuckDuckGo Search** — Alternative fallback search

### Document Workflow Status

The legacy `@rice-opencode/docs` Pandoc plugin and its `docs-workflow` skill
have been removed. Quarto is the successor direction for document authoring.
The useful IEEE and SIT/UofG LaTeX templates and logos remain under `pandoc/`
for Quarto or direct Pandoc/LaTeX workflows.

## Repository Structure

```
├── agents/                 # Agent prompt definitions
│   ├── build.md            # Core builder methodology
│   ├── chat.md             # General interactive agent
│   ├── code-checker.md     # Code verification agent
│   ├── code-writer.md      # Docs-first focused SWE implementation subagent
│   ├── document-proofreader.md
│   ├── docs-first-coder.md # Disabled deprecated alias; use code-writer
│   ├── explore.md          # File system navigator
│   ├── plan.md             # SWE planning agent
│   ├── plan-checker.md     # Workplan and handoff verification agent
│   ├── researcher.md       # Literature-review research subagent
│   └── swe.md              # SWE orchestrator
├── deprecated-agents/       # Archived agent prompts removed from active use
├── commands/               # OpenCode slash commands
├── skills/                 # OpenCode skills
├── tools/
│   └── workplan.ts         # Public workplan tool entrypoint
├── src/
│   └── custom-tools/
│       └── workplan/       # Workplan tool implementation
├── tests/
│   └── workplan/           # Focused workplan tool tests
├── packages/               # Installable and experimental plugin packages
│   ├── plugin/             # Batteries-included workflow plugin
│   ├── shared/
│   └── viz/
├── pandoc/                 # LaTeX templates and assets
│   ├── assets/            # Logo images (SIT, UofG)
│   └── templates/         # LaTeX templates
└── opencode.json          # Config preset + MCP entries
```

## Architecture Notes

This repo has two layers:

1. **Preset source and distribution** — unchanged `agents/`, `commands/`, and
   `skills/` are compiled/copied into the standalone `packages/plugin` bundle.
   `packages/shared` supplies workspace-only tool context; private `packages/viz`
   implements the image tool that is included in the main bundle.
2. **Personal examples** — `opencode.json`, `opencode.v2.json`,
   `opencode-mem.jsonc` and `pandoc/` remain repository-only, not host settings
   imposed by the plugin.

The removed docs package is not part of either layer. Its reusable presentation
assets survive in the root `pandoc/` directory while Quarto replaces the old
custom document-tool workflow.

### Why `viz` exists

`packages/viz` implements `viz_generate_image`; its code is bundled into the main
V2 plugin. No separate viz installation is required. Image generation still needs
an image-capable Responses endpoint/API key configured by the host.

## OpenCode V2 preparation

The package is **V2-only**, checked against SDK **2.0.20**. The active personal
`opencode.json` is left unchanged for the separately installed V1 environment;
do not load the new package on V1. `opencode.v2.json` is a repo-only personal
example, not the plugin installer.

The bundle compiles our unchanged frontmatter at build time, preserves body
bytes and model IDs/variants, and registers all assets through native transforms.
Core parsing is build-only; installed users do not need the repository or its
dev dependencies. Our disabled deprecated agent alias and both compaction
integrations are excluded.

Matching agent prompts/models/modes/request settings are replaced. Existing
permission lists are kept and our declared overrides appended; last match wins,
and unmatched old rules remain. Existing same-name skills and unrelated agents
are preserved. Global default selection stays unchanged; `/review` intentionally
switches only its invoking session to `build` and its configured model, as the
native command semantics require.

### Preflight

```bash
bun install --frozen-lockfile
bun run test
bun run build
bun run typecheck
bun run v2:check
bun run pack:check
```

`v2:check` validates the native schema, Core normalization, and unchanged
agent/command frontmatter, then resolves and imports the one local native bundle.
`pack:check` runs a fresh child process on a clean-room installation and verifies
all 9 tools, 6 complete skill directories, 10 agents and `/review`, model/prompt
preservation, no JSON/V1/secrets, and a real workspace-only patch.
Neither starts OpenCode, makes provider/MCP calls, or changes global config.
The published editor schema may still describe V1 fields; the version-pinned
preflight is authoritative for this template.

### Write policy

The plugin entry explicitly enables `trustedWorkspaceWrites` for workspace mutations.
Without `true`, create/update/reset/patch/image mutations are rejected; read
tools remain available. Every invocation uses its own session workspace, rejects
external workspace overrides, and retains the existing path, symlink, patch,
and overwrite checks.

This is **trusted workspace maintenance**, not V1 permission equivalence:
individual per-file `edit` allow/ask/deny rules are not evaluated by these tools.
Mutators declare the `edit` action so V2 can hide them when edits are wholly
denied. Do not enable trusted writes if you require per-file approvals.

### Compatibility changes in the V2 template

| Integration | V2 treatment |
|---|---|
| Notifier | Upgraded to verified V2-compatible `@mohak34/opencode-notifier@0.5.0` |
| Antigravity auth | Omitted: no verified V2 port; native Google auth is not equivalent to its OAuth/account rotation |
| Anthropic auth | Omitted: no verified stable V2 port under the configured name; native API-key auth is not Claude subscription OAuth |
| `opencode-mem` | Omitted: no verified V2 port; `opencode-mem.jsonc` and memory data remain untouched |
| Background agents | Omitted: use native V2 `subagent`; plugin-specific `delegation_read`/`delegation_list` persistence is not preserved |
| LSP | V2 accepts the configuration but does not supply LSP tools; use lint/typecheck/compiler checks |
| `researcher-mcp` | Disabled because `.opencode/researcher-mcp.sh` is absent; restore the launcher before re-enabling |
| DDG MCP | Existing command pinned to `@oevortex/ddg_search@1.4.0` |

Other MCP endpoints, secret references, and Hound's pinned command are preserved.
Hound's duplicate search action remains denied. For image generation, keep the
existing `VIZ_OPENAI_*` / `OPENAI_*` environment settings or configure native
`providers.openai.settings`; existing V1 provider options still work. The
default image endpoint/model are unchanged—no OpenCode OAuth credentials are
automatically converted into an image API key.

### Include in an existing V2 host

1. Add the one package entry from [`packages/plugin/README.md`](packages/plugin/README.md)
   to the host's existing `plugins` list; use `github:LLJY/rice-opencode#v0.1.0`
   or the built checkout path locally. No npm account, agent/skill directories or JSON
   need to be copied into the host.
2. Keep the host's providers/auth/MCP/default-agent settings. Ensure it supplies
   the bundled agent model IDs and external tools referenced by the prompts;
   configure the image endpoint separately when needed.
3. Do not also enable separate viz, old workflow/compaction plugins or legacy
   auto-discovered tool entries; the main V2 bundle already supplies the tools.
4. Quit and restart OpenCode after activation. Verify live model authentication,
   MCP connections, and interactive behavior in that host; static package checks
   intentionally make no provider or service calls.

If using the repository's **personal** V2 example instead, separately audit and
replace the relevant V1 config. Do not simply overlay it with `OPENCODE_CONFIG`:
V2 appends plugin lists across layers. That personal migration is not required
for installing this plugin.

See the official [V1 migration guide](https://opencode.ai/v2/docs/migrate-v1),
[plugin migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1),
and [plugin loading rules](https://opencode.ai/v2/docs/plugins).

## Personal full-config installation — optional, not plugin distribution

1. **Clone this repository** and install workspace dependencies:
   ```bash
   bun install
   ```

2. **Create local secret files:**
   ```bash
   # Environment-backed credentials
   GITHUB_PAT=your_github_pat
   CONTEXT7_API_KEY=your_context7_key
   ```
   Save the Exa API key in the global file read by `opencode.json`:
   ```bash
   mkdir -p "$HOME/.config/opencode"
   read -rsp 'Exa API key: ' EXA_API_KEY
   printf '%s' "$EXA_API_KEY" > "$HOME/.config/opencode/.exa-api-key"
   chmod 600 "$HOME/.config/opencode/.exa-api-key"
   unset EXA_API_KEY
   printf '\n'
   ```
   The key stays outside this repository. `.exa-api-key` is also gitignored
   defensively in case one is created in the checkout by mistake.

3. **Prewarm and diagnose the pinned Hound MCP tool:**
   ```bash
   uvx --from 'hound-mcp[all]==12.4.1' hound -v
   uvx --from 'hound-mcp[all]==12.4.1' hound --doctor
   ```
   OpenCode launches this same pinned environment through `uvx`, avoiding
   user-specific executable paths. If the doctor reports that Chromium is
   unavailable, install it into Playwright's user cache:
   ```bash
   uvx --from 'hound-mcp[all]==12.4.1' playwright install chromium
   ```

4. **Verify the MCP connections:**
   ```bash
   opencode mcp list
   ```
   Exa OAuth is disabled because the MCP sends the local API key through the
   `x-api-key` header.

5. **Install Quarto separately; install LaTeX when using the retained templates:**
   Follow the official [Quarto installation guide](https://quarto.org/docs/get-started/).
   The commands below install the LaTeX toolchain used by the retained templates:
   ```bash
   # Ubuntu/Debian
   sudo apt install texlive-full
   
   # macOS
   brew install --cask mactex
   ```

## Usage

### Using Agents

Agents are invoked automatically by OpenCode based on task context, or you can reference them explicitly:

```
@explore find all configuration files in this project
@build implement a non-trivial feature using the workflow skill
@researcher write a literature review on vector databases for RAG
@plan-checker review .opencode/workplan/my-plan.md before implementation
@code-writer implement a scoped React hook step following current React docs
@code-checker review the auth module
@document-proofreader review report.md
```

### Document Templates

Quarto is the preferred document-authoring workflow. Reusable presentation
assets remain available for Quarto, Pandoc, or direct LaTeX use:

- `pandoc/templates/ieee/template.latex`
- `pandoc/templates/sit-uofg/template.latex`
- `pandoc/assets/sit-logo.png`
- `pandoc/assets/uofg-logo.png`

Project skill available:

- `workflow` — on-demand OpenCode skill for durable workplans, scoped delegation, validation, and review loops

## Configuration Notes

- `opencode.json` uses `{env:VAR}` and `{file:path}` substitutions for secrets — safe to commit
- Agents/commands/skills are loaded from their directories directly
- Open-web discovery uses `exa_web_search_exa`; known URLs are retrieved with `hound_smart_fetch`
- Hound's duplicate `hound_smart_search` tool is disabled so Exa remains the canonical search path
- `researcher-mcp` is still shell-script based for now and expected to resolve via `.opencode/researcher-mcp.sh`
- Actual API keys should be in `.env` or `~/.config/opencode/.exa-api-key`, outside tracked config

## Requirements

- [OpenCode](https://opencode.ai) AI CLI
- Node.js / Bun runtime
- [uv](https://docs.astral.sh/uv/) for the pinned Hound runtime
- Quarto for document authoring and LaTeX when using the retained templates
- API keys for enabled MCP servers that use explicit headers

## License

Personal configuration — use as reference for your own setup.

# rice-opencode

Personal [OpenCode](https://opencode.ai) configuration — a complete AI-assisted development environment with specialized agents and MCP servers.

## Overview

This repository contains a fully-featured OpenCode configuration preset plus optional experimental packages. It provides specialized AI agents, integrated MCP server config, and reusable document templates.

## Features

### Specialized Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `plan` | GPT-5.5 | Requirements analysis and execution planning |
| `swe` | GPT-5.5 | Software engineering orchestrator for multi-step code work |
| `chat` | GPT-5.5 | General interactive agent |
| `build` | GPT-5.5 | High-agency implementation and verification |
| `explore` | GPT-5.5 | Fast codebase navigation and file discovery |
| `researcher` | GPT-5.4 | Literature-review research with optional read-only codebase context |
| `plan-checker` | GPT-5.5 | Workplan, spec, handoff, and workflow risk review |
| `code-writer` | GPT-5.5 | Documentation-first focused implementation subagent for scoped plan steps |
| `code-checker` | GPT-5.5 | Code review, smells detection, and verification |
| `document-proofreader` | GPT-5.5 | Academic proofreading and argument review |

### Batteries-included workflow plugin

`packages/plugin` packages the durable workflow layer as a proper OpenCode plugin. A single plugin install provides all eight workplan tools, the `workflow-plan` and `workflow-execute` skills, and additive compaction continuity for active workplans. See [`packages/plugin/README.md`](packages/plugin/README.md).

### SWE Workplan Baseline

This repo now includes a software-engineering baseline with durable workplan tools and agent prompts for structured multi-step execution.

Available workplan tools:

- `workplan_create` — create a persistent workplan under `.opencode/workplan/`
- `workplan_inspect` — list stable phase/step ids for targeted updates
- `workplan_list` / `workplan_read` — discover and inspect existing workplans
- `workplan_update` — patch phases, steps, files, findings, and notes
- `workplan_reset` — reset a stale plan or regenerate its markdown
- `workplan_validate` — validate JSON metadata, linked markdown, and spec files

### MCP Server Integrations

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

1. **OpenCode preset/config layer** — `agents/`, `commands/`, `skills/`, and
   `opencode.json` define the portable harness experience.
2. **Optional package layer** — `packages/viz` remains experimental and
   private; `packages/shared` is reserved for internal helpers.

The removed docs package is not part of either layer. Its reusable presentation
assets survive in the root `pandoc/` directory while Quarto replaces the old
custom document-tool workflow.

### Why `viz` exists

`packages/viz` is a placeholder for future visualization features like charts, diagrams, and tables for reports/papers.

Right now it is:

- private
- not loaded in `opencode.json`
- not considered part of the stable default harness

Treat `viz` as a future idea or stub, not part of the stable default harness.

## Installation

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

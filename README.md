# rice-opencode

Personal [OpenCode](https://opencode.ai) configuration — a complete AI-assisted development environment with specialized agents, MCP servers, and document generation tools.

## Overview

This repository contains a fully-featured OpenCode configuration preset plus separate plugin packages. It provides specialized AI agents for different tasks, integrated MCP server config, and a plugin-v2-compliant document generation package.

## Features

### Specialized Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `plan` | GPT-5.5 | Requirements analysis and execution planning |
| `swe` | GPT-5.5 | Software engineering orchestrator for multi-step code work |
| `chat` | GPT-5.5 | General interactive agent |
| `build` | GPT-5.5 | High-agency implementation and verification |
| `explore` | GPT-5.5 | Fast codebase navigation and file discovery |
| `code-writer` | GPT-5.5 | Focused implementation subagent for scoped plan steps |
| `docs-first-coder` | GPT-5.5 | Documentation-verified coding with live API research |
| `code-checker` | GPT-5.5 | Code review, smells detection, and verification |
| `document-proofreader` | GPT-5.5 | Academic proofreading and argument review |

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
- **Brave Search** — Web search via Brave API
- **DuckDuckGo Search** — Alternative web search

### Document Generation Plugin

Main plugin package: `@rice-opencode/docs`

Plugin-v2 structure:

- package root export: `packages/docs/index.ts`
- server entrypoint: `packages/docs/src/server.ts`
- tool implementation: `packages/docs/src/plugin.ts`

Capabilities:

- **IEEE Papers** — Two-column conference and journal formats
- **School Reports** — SIT/UofG branded reports with logos
- **Styled PDFs** — Professional documents with Eisvogel template
- **Format Conversion** — Pandoc-powered format conversion
- **Sidecar Bibliographies** — `refs.bib` workflow for scholarly citations
- **Citation Styles** — args-based `citation_style` handling (`ieee`, `apa`, `acm`, `none`)

## Repository Structure

```
├── agents/                 # Agent prompt definitions
│   ├── build.md            # Core builder methodology
│   ├── chat.md             # General interactive agent
│   ├── code-checker.md     # Code verification agent
│   ├── code-writer.md      # Focused SWE implementation subagent
│   ├── document-proofreader.md
│   ├── docs-first-coder.md # Documentation-first coding
│   ├── explore.md          # File system navigator
│   ├── plan.md             # SWE planning agent
│   └── swe.md              # SWE orchestrator
├── commands/               # OpenCode slash commands
├── skills/                 # OpenCode skills
├── tools/
│   └── workplan.ts         # Public workplan tool entrypoint
├── src/
│   └── custom-tools/
│       └── workplan/       # Workplan tool implementation
├── tests/
│   └── workplan/           # Focused workplan tool tests
├── packages/               # TypeScript package/plugin code
│   ├── docs/
│   ├── shared/
│   └── viz/
├── pandoc/                 # LaTeX templates and assets
│   ├── assets/            # Logo images (SIT, UofG)
│   └── templates/         # LaTeX templates
└── opencode.json          # Config preset + MCP entries + local docs plugin path
```

## Architecture Notes

This repo now has **two layers**:

1. **OpenCode preset/config layer**
   - `agents/`, `commands/`, `skills/`, and `opencode.json`
   - this is the "rice" harness/config experience
   - it decides which plugins and MCP servers are loaded locally

2. **Plugin package layer**
   - `packages/docs` is the real plugin-v2-compliant package
   - `packages/viz` is an experimental private package and is **not** loaded by default
   - `packages/shared` is reserved for future internal helpers

### Plugin v2 shape

The docs plugin follows the same general structure as modern OpenCode plugins such as `opencode-usage-tracker`:

- `index.ts` — package root export
- `src/server.ts` — plugin server module
- `src/plugin.ts` — actual tool and hook implementation

The important part is that `src/server.ts` default-exports a module shaped like:

```ts
{
  id: "@rice-opencode/docs",
  server: DocsPlugin,
}
```

That is the plugin-v2-compatible server entrypoint shape.

### Why `viz` exists

`packages/viz` is a placeholder for future visualization features like charts, diagrams, and tables for reports/papers.

Right now it is:

- private
- not loaded in `opencode.json`
- not considered part of the stable default harness

So for now, treat:

- `docs` = real maintained plugin package
- `viz` = future idea / stub

### Can one package bundle multiple features?

Yes. A future all-in-one harness can still be compliant if it:

- combines multiple server-side features behind one `server` plugin module
- keeps optional UI/TUI behavior in a separate `./tui` export
- avoids loading unfinished features by default

In this repo, we intentionally keep the stable docs feature separate and keep experimental work out of the default plugin path.

## Installation

1. **Clone this repository** and install workspace dependencies:
   ```bash
   bun install
   ```

2. **Use the bundled local docs plugin path** from this repository:
   ```bash
   # already configured in opencode.json
   # plugin: ["./packages/docs", ...]
   ```

3. **Create `.env` with API keys:**
   ```bash
   GITHUB_PAT=your_github_pat
   BRAVE_API_KEY=your_brave_key
   CONTEXT7_API_KEY=your_context7_key
   ```

4. **Install LaTeX** (for document generation):
   ```bash
   # Ubuntu/Debian
   sudo apt install texlive-full
   
   # macOS
   brew install --cask mactex
   ```

### Publishing the docs plugin separately

The main publishable package is `packages/docs`.

- local development path: `./packages/docs`
- package root export: `@rice-opencode/docs`
- explicit server subpath: `@rice-opencode/docs/server`

`viz` is intentionally not loaded by default.

## Usage

### Using Agents

Agents are invoked automatically by OpenCode based on task context, or you can reference them explicitly:

```
@explore find all configuration files in this project
@swe implement a non-trivial feature with a durable workplan
@docs-first-coder implement a React hook following current React docs
@code-checker review the auth module
@document-proofreader review report.md
```

### Document Generation

Available tools when working with documents:

- `docs_convert` — Convert between formats (markdown, PDF, docx, etc.)
- `docs_create` — Create documents using presets
- `docs_create_ieee_paper` — IEEE conference/journal papers
- `docs_create_styled_pdf` — Professional styled PDFs
- `docs_templates_list` — List installed templates
- `docs_templates_install` — Install templates and CSL styles
- `docs_presets_list` / `docs_presets_show` — Manage document presets

Recommended scholarly workflow:

- Keep document content in markdown
- Keep references in a sidecar `refs.bib`
- Use Pandoc citation syntax like `[@key]`
- Select citation rendering with `citation_style`
  - `ieee` uses the IEEE-specific LaTeX/BibTeX path for IEEE presets
  - `apa` / `acm` use CSL + citeproc

Project skill available:

- `docs-workflow` — on-demand OpenCode skill for choosing the right docs tool flow, presets, `refs.bib`, and `citation_style`

**Presets:**
- `school-report` — SIT/UofG reports (`--logo sit|uofg|both`)
- `ieee-conference` — IEEE two-column conference papers
- `ieee-journal` — IEEE journal format
- `eisvogel` — General professional documents

## Configuration Notes

- `opencode.json` uses `{env:VAR}` syntax for secrets — safe to commit
- Agents/commands/skills are loaded from their directories directly
- The local docs plugin is loaded from `./packages/docs`
- `researcher-mcp` is still shell-script based for now and expected to resolve via `.opencode/researcher-mcp.sh`
- Actual API keys should be in `.env` (gitignored)

## Requirements

- [OpenCode](https://opencode.ai) AI CLI
- Node.js / Bun runtime
- LaTeX installation (for document generation)
- API keys for enabled MCP servers

## License

Personal configuration — use as reference for your own setup.

# rice-opencode

Personal [OpenCode](https://opencode.ai) configuration — a complete AI-assisted development environment with specialized agents, MCP servers, and document generation tools.

## Overview

This repository contains a fully-featured OpenCode configuration preset plus separate plugin packages. It provides specialized AI agents for different tasks, integrated MCP server config, and a plugin-v2-compliant document generation package.

## Features

### Development entry point

Run OpenCode 2 in your project and use:

```text
/dev Add pagination to the activity feed and verify it.
```

`/dev` selects `build` on Sol Medium. It handles small clear changes directly,
delegates bounded engineering to Terra, and invokes the Sol High `plan` agent
when architecture, uncertainty or coordination warrants a plan. After a ready
plan returns, build executes within the original implementation authorization,
collects validation evidence, and obtains independent review for significant
changes. Explicit research-only, review-only and plan-only requests retain their
boundaries; commits, pushes and deployment need their own authorization.

A reusable plain starter prompt for the build agent is:

```text
Use the development workflow for this task: <desired outcome>.
Inspect the repository first. Choose direct implementation, bounded workers,
or a plan based on uncertainty and dependencies. Execute the ready plan within
my requested scope, verify the result, and report evidence. Ask only about
material unresolved decisions. Constraints: <constraints, if any>.
```

The default agent remains `plan`; `/dev` is the explicit automatic-development
entry point. `plan` uses mode `all` so it can be selected manually or called by
build. Build remains the execution orchestrator; there is no extra lead-agent
layer. Workers have fresh context and implementation/review workers cannot
recursively delegate.

### Specialized Agents

| Agent | Model | Purpose |
| --- | --- | --- |
| `build` | Sol Medium | Development routing, delegation, integration and acceptance |
| `plan` | Sol High | Approach, durable plans, ownership and acceptance criteria |
| `explore` | Luna High | Read-only repository evidence |
| `researcher` | Terra High | External documentation and literature synthesis |
| `plan-checker` | Sol High | Independent plan executability and reference review |
| `code-writer` / `frontend-engineer` | Terra High | Scoped implementation and self-tests |
| `tester` | Luna Medium | Specified validation and reproduction; no repairs |
| `code-checker` | Sol High | Independent significant-change correctness review |
| `oracle` | Sol XHigh | Exceptional read-only diagnosis and architecture advice |
| Document agents | Terra High | Substantive authorship and proofreading |

Astra was absent from the verified OpenCode catalog on 2026-09-05; oracle uses
Sol XHigh explicitly. Model variants were checked through the local V2 API.

All user-facing agent definitions are canonical in `agents/*.md`, including
model, permissions and prompt. JSON only overrides internal/general agents.
The old files in `prompts/` are inactive pointers. Do not reintroduce duplicate
agent definitions: V2 appends permissions and later matching rules win.

### SWE Workplan Baseline

This repo now includes a software-engineering baseline with durable workplan tools and agent prompts for structured multi-step execution.

The legacy workplan tool source exports:

- `workplan_create` — create a persistent workplan under `.opencode/workplan/`
- `workplan_inspect` — list stable phase/step ids for targeted updates
- `workplan_list` / `workplan_read` — discover and inspect existing workplans
- `workplan_update` — patch phases, steps, files, findings, and notes
- `workplan_reset` — reset a stale plan or regenerate its markdown
- `workplan_validate` — validate JSON metadata, linked markdown, and spec files


The current V2 runtime did not expose these custom tools in a model-visible
catalog check. `workflow-plan` and `workflow-execute` therefore support native
read/edit operations on the same version-2 JSON and Markdown artifacts. No V1
plugin installation is needed. Rich ownership, dependencies, acceptance and
execution receipts live in Markdown, with concise state/decision pointers in
JSON notes; this change does not migrate the JSON schema.

See [the artifact/evidence contract](skills/workflow-plan/references/workplan-contract.md).
Structural validity, readiness to execute, and evidence-backed completion are
separate checks. Parent agents own shared execution state; worker receipts do
not constitute final acceptance. Keep failed attempts and session IDs, reuse
current validation evidence, and stop non-converging review/fix loops after
three cycles.

For deterministic structural validation without custom-tool registration:

```sh
bun ~/.config/opencode/scripts/check-workplan.ts /absolute/project/root workplan-id
```

The helper is read-only and rejects incompatible schema versions, field types,
statuses and missing linked artifacts. It does not establish acceptance or run
the plan's tests. Build runs it after a delegated planner returns.

The routing and review design adapts selected ideas from
[OMO Prometheus](https://github.com/code-yeongyu/oh-my-openagent/blob/e7774e283ff197cf6f66df2e82ca7a2f253ae605/packages/prompts-core/prompts/prometheus/default.md),
[Atlas](https://github.com/code-yeongyu/oh-my-openagent/blob/e7774e283ff197cf6f66df2e82ca7a2f253ae605/packages/prompts-core/prompts/atlas/gpt.md), and
[Momus](https://github.com/code-yeongyu/oh-my-openagent/blob/e7774e283ff197cf6f66df2e82ca7a2f253ae605/packages/omo-opencode/src/agents/momus.ts).
It does not install OMO, add its continuation hooks, or require its team tools.

### MCP Server Integrations

- **GitHub Copilot** — Code search and repository intelligence
- **DeepWiki** — Repository documentation and structure analysis
- **Context7** — Library documentation queries
- **gofetch** — Open-web search plus webpage/PDF retrieval via the local `gofetch-mcp` submodule (Exa API when `.exa-api-key` is present, keyless DuckDuckGo/Mojeek fallback)
- **Exa** — Remote search MCP, kept in config but disabled; `gofetch_web_search` is the canonical search path

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
│   ├── code-checker.md     # Code verification agent
│   ├── code-writer.md      # Docs-first focused SWE implementation subagent
│   ├── document-proofreader.md
│   ├── document-writer.md
│   ├── explore.md          # File system navigator
│   ├── frontend-engineer.md
│   ├── oracle.md            # Exceptional architecture/debugging advisor
│   ├── plan.md             # SWE planning agent
│   ├── plan-checker.md     # Workplan and handoff verification agent
│   ├── researcher.md       # Literature-review research subagent
│   └── tester.md           # Validation and reproduction agent
├── commands/               # OpenCode slash commands
├── skills/                 # OpenCode skills
│   ├── workflow-plan/       # Durable planning and evidence contract
│   └── workflow-execute/    # Scoped execution and acceptance
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

3. **Create local secret files:**
   ```bash
   # Environment-backed credentials
   GITHUB_PAT=your_github_pat
   CONTEXT7_API_KEY=your_context7_key
   ```
   Save the Exa API key in the global file read by gofetch-mcp:
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

4. **Build the gofetch MCP binary:**
   ```bash
   git submodule update --init mcps/gofetch-mcp
   make -C mcps/gofetch-mcp build   # -> mcps/gofetch-mcp/bin/gofetch
   ```

5. **Verify the MCP connections:**
   ```bash
   opencode mcp list
   ```
   The remote `exa` entry stays disabled in `opencode.json`; gofetch reads the
   same `.exa-api-key` file directly.

6. **Install LaTeX** (for document generation):
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
/dev implement a non-trivial feature with relevant validation
@researcher write a literature review on vector databases for RAG
@plan-checker review .opencode/workplan/my-plan.md before implementation
@code-writer implement a scoped React hook step following current React docs
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
- `workflow-plan` / `workflow-execute` — durable plans, scoped delegation, validation, and review; automatically selected by `/dev` when useful

**Presets:**
- `school-report` — SIT/UofG reports (`--logo sit|uofg|both`)
- `ieee-conference` — IEEE two-column conference papers
- `ieee-journal` — IEEE journal format
- `eisvogel` — General professional documents

## Configuration Notes

- `opencode.json` uses `{env:VAR}` and `{file:path}` substitutions for secrets — safe to commit
- Agents/commands/skills are loaded from their directories directly
- The local docs plugin is loaded from `./packages/docs`
- Open-web discovery uses `gofetch_web_search`; known URLs are retrieved with `gofetch_fetch`
- The remote Exa MCP entry is kept in `opencode.json` but disabled; gofetch calls the Exa API directly when `.exa-api-key` exists, falling back to DuckDuckGo/Mojeek without a key
- `researcher-mcp` is still shell-script based for now and expected to resolve via `.opencode/researcher-mcp.sh`
- Actual API keys should be in `.env` or `~/.config/opencode/.exa-api-key`, outside tracked config

## Requirements

- [OpenCode](https://opencode.ai) AI CLI
- Node.js / Bun runtime
- Go toolchain (to build the `gofetch-mcp` submodule)
- LaTeX installation (for document generation)
- API keys for enabled MCP servers that use explicit headers

## License

Personal configuration — use as reference for your own setup.

# rice-opencode

Personal OpenCode configuration preset and separate plugin packages.

## What is this?

This repository contains my OpenCode-AI configuration, including:

- **Custom agents** - Specialized AI agent prompts for different tasks
- **Document generation plugin package** - Plugin-v2-compliant Pandoc-based docs tools under `packages/docs`
- **Templates** - LaTeX templates for IEEE papers, school reports (SIT/UofG)
- **MCP server configs** - GitHub, Context7, DeepWiki, Brave Search, DDG Search

## Structure

```
├── agents/           # Agent prompt files
├── commands/         # Slash commands
├── skills/           # Skills
├── packages/docs/    # Main docs plugin package
├── packages/viz/     # Experimental viz plugin package (not loaded by default)
├── pandoc/
│   ├── assets/       # Logo images (SIT, UofG)
│   └── templates/    # LaTeX templates
└── opencode.json     # Main OpenCode config preset + local plugin path
```

## Architecture Notes

This repo is no longer just "one plugin".

It is split into:

- a **config/preset layer** (`agents`, `commands`, `skills`, `opencode.json`)
- a **plugin package layer** (`packages/docs`, `packages/viz`, `packages/shared`)

### Stable package

`packages/docs` is the main stable package.

- package name: `@rice-opencode/docs`
- plugin-v2 server entrypoint: `packages/docs/src/server.ts`
- implementation: `packages/docs/src/plugin.ts`
- bundled templates/assets live under `packages/docs/pandoc/`

### Experimental package

`packages/viz` exists for future chart/diagram/table generation ideas.

It is currently:

- private
- not loaded by default
- not part of the stable user-facing path

### Intent

The current architecture is aiming for:

- one clean, publishable docs plugin package
- one local OpenCode preset that can load that package
- room for a future all-in-one harness later, without forcing unfinished features into the default setup

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| plan | GPT-5.5 | Requirements analysis and execution planning |
| chat | GPT-5.5 | General interactive agent |
| build | GPT-5.5 | High-agency implementation and verification |
| explore | GPT-5.5 | Fast codebase navigation and file discovery |
| docs-first-coder | GPT-5.5 | Documentation-verified coding |
| code-checker | GPT-5.5 | Code review and verification |
| document-proofreader | GPT-5.5 | Academic proofreading and argument review |

## Document Plugin

The main docs package is `@rice-opencode/docs` with a plugin-v2 server entrypoint at `packages/docs/src/server.ts`.

Its tool implementation provides:

- `docs_convert` - Basic format conversion via pandoc
- `docs_create_styled_pdf` - Professional PDFs with Eisvogel template
- `docs_create_ieee_paper` - IEEE two-column conference papers
- `docs_templates_list` - List installed templates
- `docs_templates_install` - Install templates (eisvogel, ieee) and CSL styles
- `docs_presets_list` / `docs_presets_show` - Manage document presets
- `docs_create` - Universal document creation with preset support

### Presets

- `school-report` - SIT/UofG reports with logo support (`--logo sit|uofg|both`)
- `ieee-conference` - IEEE two-column conference papers
- `ieee-journal` - IEEE journal format
- `eisvogel` - General professional documents

## Setup

1. Copy to `~/.config/opencode/` or use as project-local config
2. Create `.env` with API keys:
   ```
   GITHUB_PAT=your_github_pat
   BRAVE_API_KEY=your_brave_key
   CONTEXT7_API_KEY=your_context7_key
   ```
3. Install dependencies: `bun install` or `npm install`

## Notes

- `opencode.json` uses `{env:VAR}` syntax for secrets - safe to commit
- the docs plugin is loaded locally from `./packages/docs`
- `researcher-mcp` still expects a shell-script launcher path for now
- Actual API keys should be in `.env` (gitignored)
- Templates require LaTeX installation (texlive-full recommended)

# rice-opencode

Personal OpenCode configuration backup and custom plugins.

## What is this?

This repository contains my OpenCode-AI configuration, including:

- **Custom agents** - Specialized AI agent prompts for different tasks
- **Document generation plugin** - Pandoc-based tool for creating PDFs, academic papers, and reports
- **Templates** - LaTeX templates for IEEE papers, school reports (SIT/UofG)
- **MCP server configs** - GitHub, Context7, DeepWiki, Brave Search, DDG Search

## Structure

```
├── agents/           # Agent prompt files (referenced by opencode.json)
├── plugins/          # OpenCode plugin source (TypeScript)
├── src/              # Supporting modules for plugins
├── pandoc/
│   ├── assets/       # Logo images (SIT, UofG)
│   └── templates/    # LaTeX templates
└── opencode.json     # Main OpenCode configuration
```

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| explore | Gemini 3 Flash | Fast codebase navigation and file discovery |
| docs-first-coder | Claude Opus 4.5 | Documentation-verified coding |
| code-checker | Gemini 3 Flash | Code review and verification |
| esp32-tdd-coder | Claude Opus 4.5 | ESP32 embedded development (TDD) |
| esp32-tdd-test-writer | GLM-4.7 | ESP32 test generation from specs |
| document-writer | Kimi K2 Thinking | Academic papers and reports |

## Document Plugin

The `plugins/docs.ts` provides tools for document generation:

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
- Actual API keys should be in `.env` (gitignored)
- Templates require LaTeX installation (texlive-full recommended)

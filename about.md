# rice-opencode

`rice-opencode` is Lucas's one-package OpenCode harness. The repository root is directly installable as `@rice-opencode/plugin`; [`README.md`](README.md) is the installation and compatibility source of truth.

## Stable runtime surface

The package registers:

- active Markdown agents from `agents/`
- the `/review` command from `commands/`
- skill discovery from `skills/`
- eight workplan tools from `src/custom-tools/workplan*`
- seven MCP integrations from `src/plugin/mcp.ts`

`src/plugin/index.ts` is the package entrypoint. `opencode.json` loads that entrypoint directly for repository development.

## Repository resources

- `pandoc/` retains reusable document templates and logos.
- `packages/viz` and `packages/shared` remain private experimental workspaces and are not shipped in the stable plugin package.
- Deprecated agents remain as source material only when marked `disable: true`; the package loader excludes them.

## Credentials

GitHub, Context7, and Exa credentials are read from mode-`0600` files under `~/.config/opencode/`. They are not committed, passed in MCP command-line arguments, or sourced from the old root environment-variable preset. See [`credentials/README.md`](credentials/README.md).

## MCP installation model

Local MCPs use pinned `npx`, `uvx`, or Docker invocations so their runtimes download into normal user caches on first launch. The Go Researcher MCP is bundled as a verified Linux x86-64 binary. DeepWiki is remote-only.

## Compaction

Rice does not export a compaction agent or `experimental.session.compacting` hook. Current OpenCode V2 compaction continuity belongs in OpenCode core, not this preset.

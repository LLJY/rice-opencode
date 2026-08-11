# rice-opencode

A one-stop OpenCode plugin containing the complete stable Rice harness:

- 10 active agents
- `/review` command
- 6 reusable skills
- 8 durable workplan tools
- 7 MCP integrations

The repository root is the package. No files need to be copied into `~/.config/opencode/agents`, `commands`, `skills`, or `plugins`.

## Install

Until the package is published to npm, add the GitHub repository directly:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:LLJY/rice-opencode#master"]
}
```

After an npm release, the equivalent entry is:

```json
{
  "plugin": ["@rice-opencode/plugin"]
}
```

After replacing the old preset, remove copied Rice agent/command/skill directories and any old Rice-owned MCP definitions if you want the package defaults. Explicit existing definitions with the same names remain authoritative by design. Provider/auth plugins and personal model settings stay separate.

OpenCode installs the package and its JavaScript dependencies automatically. The package loads directly from committed TypeScript source because OpenCode intentionally disables package lifecycle scripts.

## Credentials

API keys are read only from files under `~/.config/opencode/`:

| Integration | File |
|---|---|
| GitHub | `~/.config/opencode/.github-pat` |
| Context7 | `~/.config/opencode/.context7-api-key` |
| Exa | `~/.config/opencode/.exa-api-key` |

Create only the files for integrations you use. A missing or empty credential file disables that MCP without preventing the rest of Rice from loading.

```bash
install -d -m 700 "$HOME/.config/opencode"
umask 077

read -rsp 'GitHub PAT: ' KEY; printf '%s' "$KEY" > "$HOME/.config/opencode/.github-pat"; unset KEY; printf '\n'
read -rsp 'Context7 API key: ' KEY; printf '%s' "$KEY" > "$HOME/.config/opencode/.context7-api-key"; unset KEY; printf '\n'
read -rsp 'Exa API key: ' KEY; printf '%s' "$KEY" > "$HOME/.config/opencode/.exa-api-key"; unset KEY; printf '\n'
```

See [`credentials/README.md`](credentials/README.md) for the exact contract.

## MCP behavior

Rice uses package runners so local MCPs install into their normal user caches on first launch—never globally and never with `sudo`.

| MCP | Runtime |
|---|---|
| GitHub | official `ghcr.io/github/github-mcp-server:v1.9.0` Docker image |
| Context7 | `npx -y @upstash/context7-mcp@4.0.1` |
| Exa | `npx -y exa-mcp-server@3.4.0` |
| Hound | `uvx` with `hound-mcp[all]==12.4.1` |
| DuckDuckGo | `uvx` with `duckduckgo-mcp-server==0.6.1` |
| Researcher | bundled verified Go binary, Linux x86-64 |
| DeepWiki | official remote-only service |

GitHub requires Docker. Context7 and Exa require `npx`. Hound and DuckDuckGo require `uvx`. Researcher is disabled automatically on unsupported platforms.

## Included agents

`build`, `chat`, `swe`, `plan`, `explore`, `researcher`, `plan-checker`, `code-writer`, `code-checker`, and `document-proofreader`.

Rice supplies defaults while preserving explicit user overrides. Existing agent model choices, command settings, MCP definitions, and tool settings win over the preset.

## Deliberately not included

- Legacy compaction hooks or compaction-agent overrides. Current OpenCode V2 owns compaction continuity in core.
- `packages/viz`, which remains private and experimental.
- Deprecated agents and retained document templates, which are repository resources rather than active runtime features.
- Third-party auth, memory, notifier, background-agent, and DCP plugins. They have independent release lifecycles; one former dependency is no longer published. Add any desired companion separately.

## Development and verification

```bash
bun install
bun run typecheck
bun run build
bun run pack:check
```

`pack:check` packs the repository root, installs it in a clean directory, imports the plugin, and verifies the complete runtime surface and bundled Researcher binary checksum.

## License

Personal configuration; currently unlicensed for redistribution.

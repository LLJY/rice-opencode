# OpenCode 2 migration and oh-my-openagent feasibility

Original migration assessment: 2026-09-04

## Routing update — 2026-09-05

`/dev <request>` now selects build on Sol Medium and automatically routes to
plan (Sol High, mode all), implementation workers (Terra High), tester (Luna
Medium), and independent code review (Sol High) as the task warrants. Oracle
uses Sol XHigh because Astra was absent from the live OpenCode model catalog.
The default agent remains plan. See README for usage and the current roster.

Agent Markdown now owns each user-facing prompt, model and permissions;
duplicate JSON definitions have been removed. Read-only agents deny shell and
edit tools; plan permits edits only in planning/spec directories and cannot
spawn implementers. Workers cannot recursively delegate.

A live tool-catalog probe confirmed that this V2 runtime does not expose the
legacy workplan_* custom tools. The updated skills use native read/edit tools
on the existing version-2 JSON/Markdown artifacts when those tools are absent.
Acceptance criteria and execution receipts remain in Markdown; no schema
migration or V1 plugin installation was performed. The original assessment
below records the pre-update migration state, not the current routing setup.


## Working setup

- OpenCode 1 remains installed as `opencode`, but the active global config is
  now native V2 and should be used with `opencode2`. Restore the backup before
  launching V1 again.
- OpenCode 2 is installed side by side as `opencode2` (`v0.0.0-beta-19086`).
- `opencode.json` now uses the native OpenCode 2 shape for agents, permissions,
  MCP servers, providers, plugins, update policy, and sharing policy.
- Agent Markdown frontmatter now uses native V2 model references, ordered
  permission rules, `disabled`, and `request.body` fields.
- Commands and skills remain in their existing directories because V2 discovers
  both layouts without requiring content changes.
- V1 package and local plugins are not registered in the V2 configuration.

Run the beta with:

```sh
opencode2
```

The current MCP headers expect `CONTEXT7_API_KEY` and `EXA_API_KEY` in the
process environment. The unused GitHub MCP has been removed.

## Validation performed

The migrated config was loaded by `opencode2 debug config`, and the resolved
configuration contained twelve JSON-defined agent overrides, six MCP servers, the
`vllm-hotaisle` provider, and no V1 plugins. `opencode2 debug agents` resolved
16 visible and internal agents, including the additional file-defined agents.

`opencode2 models` found both the configured OpenAI GPT models and the custom
vLLM model. `opencode2 mcp list` connected the local `gofetch` and
`researcher-mcp` servers immediately; HTTP and command-backed servers can show
as pending briefly after a service restart and connect lazily.

Repository checks also passed:

```sh
bun test tests/qwen-single-system.test.ts
npm run typecheck
```

## Model strategy

The model assignments use the OpenAI models available through the connected
account and keep high-cost reasoning focused on roles where it has the most
impact:

| Tier | Agents | Selection |
| --- | --- | --- |
| Exceptional advice | `oracle` | `gpt-5.6-sol#xhigh` for rare architecture or debugging escalation |
| High-leverage reasoning | `plan`, `plan-checker`, `code-checker` | `gpt-5.6-sol#high` for planning and independent review |
| Development orchestration | `build` | `gpt-5.6-sol#medium` for routing, integration, and acceptance |
| Balanced specialists | `code-writer`, `researcher`, document and frontend agents, `general`, `compaction` | `gpt-5.6-terra` variants for reliable specialist work at lower overhead than Sol |
| Fast utility | `explore`, `tester`, `summary`, `title` | `gpt-5.6-luna` variants for repository evidence, validation, and summaries |

The root fallback is `gpt-5.6-terra`. Duplicate JSON and Markdown agent model
choices are aligned so config precedence no longer changes the effective model.
The local Qwen model remains selectable but is not assigned automatically: its
V1 system-message compatibility plugin is unavailable on V2, and it has not
been validated for the orchestration prompts or tool-heavy agents.

## oh-my-openagent compatibility

The Ultimate/OpenCode edition is not currently compatible with OpenCode 2.
OpenCode's migration guide states that V1 plugin implementations do not work in
V2 and that the V2 plugin API is still being finalized. The audited
oh-my-openagent `dev` branch identifies itself as `5.0.0-beta.40`, while its
OpenCode adapter depends on `@opencode-ai/plugin` and `@opencode-ai/sdk`
`1.18.22`. Its adapter exports the V1 server plugin and uses V1 lifecycle hooks
such as `experimental.chat.messages.transform` and
`experimental.chat.system.transform`.

Installing the Ultimate edition into this V2 config would therefore register a
V1 plugin that cannot provide its agents, hooks, tools, or orchestration
reliably. It has intentionally not been installed.

| Capability | Feasibility on V2 now | Migration path |
| --- | --- | --- |
| Custom agents and model routing | High | Define native V2 agents and ordered permissions. The existing agents are migrated. |
| Slash commands and skills | High | Keep Markdown commands and skill directories; V2 discovers them. |
| OMO's bundled MCP services | High | Register each MCP directly under `mcp.servers`, independent of the OMO plugin. |
| Basic background delegation | Medium to high | Use V2's native `subagent` tool and background child sessions. |
| `ultrawork` prompt workflow | Medium | Port its prompt, commands, and skills, then replace V1 hook-dependent continuation behavior with V2 equivalents. |
| Team Mode and specialized orchestration | Medium to low | Rebuild against V2 background subagents; OMO's `team_*` tools and state management require a plugin port. |
| 54+ lifecycle hooks, continuation loops, IntentGate | Low today | Wait for the V2 plugin API to stabilize, then write a V2 adapter around OMO's increasingly separated core packages. |
| LSP integration | Low today | V2 accepts LSP config but does not start language servers yet; a V2 plugin or MCP bridge is required. |
| Hash-anchored edits | Low today | Requires a V2 edit tool/plugin implementation. |

The upstream multi-harness refactor improves longer-term feasibility because it
is separating shared TypeScript logic, MCP servers, skills, and host adapters.
That makes a dedicated OpenCode 2 adapter realistic, but it is still a software
port rather than a configuration-only installation.

## Existing plugin impact

The following former V1 registrations are omitted from the V2 config:

- `opencode-antigravity-auth` and both Anthropic auth entries: use V2 provider
  authentication where available; port only provider flows V2 does not supply.
- `@mohak34/opencode-notifier`: requires a V2 server or CLI plugin equivalent.
- `opencode-mem` and the local `opencode-recall`: their data remains untouched,
  but their message hooks and client calls require V2 ports.
- `opencode-background-agents`: V2 supplies native background subagents for the
  core delegation use case; plugin-specific management features require a port.
- `src/plugins/qwen-single-system.ts`: its small system-message transform is a
  good first local plugin to port once the corresponding V2 hook contract is
  published.

## Security and rollback

Older tracked history contains a literal Exa credential. GitHub and Context7
values were expanded from the runtime environment by an earlier diagnostic,
not stored literally in the repository. The active V2 configuration uses
environment references for the remaining MCP credentials. Rotate the exposed
credentials; removing the old Exa value from Git history requires a coordinated
force-push and fresh clones for other users.

The pre-migration snapshot is commit `d470358` on
`codex/backup-pre-v2-2026-09-04`. To inspect it without changing the current
branch:

```sh
git show d470358:opencode.json
```

## Sources

- [OpenCode 2 introduction and installation](https://opencode.ai/v2/docs)
- [OpenCode V1-to-V2 migration guide](https://opencode.ai/v2/docs/migrate-v1)
- [OpenCode 2 configuration](https://opencode.ai/v2/docs/config)
- [OpenCode 2 plugins](https://opencode.ai/v2/docs/plugins)
- [oh-my-openagent repository](https://github.com/code-yeongyu/oh-my-openagent)
- [oh-my-openagent installation guide](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/installation.md)

# reasoning-router (V2-only)

Deterministic semantic-class routing to OpenAI reasoning effort for subagents.

## Install

```sh
opencode2 plugin add 'github:hoshinoht/rice-opencode#v2::path:packages/reasoning-router'
```

An orchestrating model requests a bounded class (`auto` / `fast` / `balanced` /
`deep`); a session `context` hook scoped to the OpenAI provider sets
`providerOptions.reasoningEffort` immediately before each model call. Agent
policy decides the actual effort, so model requests cannot bypass cost/quality
caps. Native subagent lifecycle, permissions, concurrency, and continuation
behavior are untouched.

## Request

Start the child task with a validated marker (first match wins, stripped from
every outgoing call):

```text
[reasoning:fast] Find all config files that mention retries.
[reasoning:deep:escalate] Diagnose the flaky migration failure.
```

Only delegated child sessions (those with a parent session) are routed; root
sessions keep their configured model variant even when they run a
policy-listed agent such as `plan`. Child status is looked up once per session
and cached; a failed lookup logs a warning and routes as a child so transient
metadata outages degrade to unscoped routing rather than silent disablement.

| Class      | Base effort | Use for                                              |
| ---------- | ----------- | ---------------------------------------------------- |
| `auto`     | agent default | Default; no marker behaves the same                |
| `fast`     | low         | Lookup, deterministic validation                     |
| `balanced` | medium      | Bounded implementation, research                     |
| `deep`     | high        | Planning, review, debugging, consequential decisions |

Append `:escalate` (or `+escalate`) for repeated failed approaches,
contradictory evidence, migrations, security-sensitive work, or destructive
operations. Escalation moves one level and never exceeds the agent maximum.

Never request raw effort values (`low`, `xhigh`, ...): they are not markers and
are ignored by the router.

## Policy

| Agents | Default | Allowed range |
| --- | --- | --- |
| `explore`, `tester` | low | low-medium |
| `code-writer`, `frontend-engineer` | medium | medium-high |
| `researcher`, `document-writer`, `document-proofreader` | medium | low-high |
| `plan`, `plan-checker`, `code-checker` | high | medium-high |
| `oracle` | xhigh | high-max |

Requests outside the agent range are clamped, and the resolved effort is always
intersected with the agent range, so caps hold even when the model supports a
wider set. Unknown agents and the primary/auxiliary agent IDs (`build`,
`general`, `compaction`, `title`, `summary`) keep their configured model
variant.

## Providers

Only configured providers are routed (default: `openai` via the verified
OpenAI Responses `reasoningEffort` key). Other providers keep their model
behavior. To route another provider, add a rule with a verified,
protocol-semantic option key — unverified keys can break requests, so they are
never guessed:

```jsonc
{
  "package": "./packages/reasoning-router",
  "options": {
    "providers": {
      "openai": {},
      // "acme": { "option": "thinkingEffort", "efforts": ["low", "medium", "high"] },
    },
  },
}
```

`efforts` defaults to the global `supportedEfforts` ladder. An empty
`providers` map disables routing while keeping `reasoning_router_status`
available.

## Stability

The resolved effort is stored by child session ID on the first model call and
reapplied to every continuation, so a session never changes effort mid-flight
and parallel sessions cannot leak state into each other. If a session switches
agents, the stored resolution is dropped and re-resolved from the persisted
marker.

The V2 `context` hook exposes no request kind, and title requests never invoke
it. Compaction and transient generation for a routed child therefore inherit
that session's stable effort rather than being excluded; this keeps checkpoint
summaries consistent with the session instead of silently changing reasoning
mid-flight.

## Diagnostics

Each first-call resolution logs one line
(`session`, `agent`, `requested`, `resolved`, matched `rule`) and appends a
record without prompt content. Inspect recent decisions with:

```text
reasoning_router_status { "sessionID": "ses_abc", "limit": 20 }
```

## Options (`opencode.json`)

```jsonc
{
  "package": "./packages/reasoning-router",
  "options": {
    "diagnosticsLimit": 100, // 1..1000 kept in memory
    // "supportedEfforts": ["low", "medium", "high", "xhigh", "max"], // default ladder for provider entries
    // "providers": { "openai": {}, "acme": { "option": "thinkingEffort", "efforts": ["low", "medium", "high"] } },
    // "agentPolicy": { "explore": { "def": "low", "min": "low", "max": "medium" } },
    // "classBase": { "fast": "low", "balanced": "medium", "deep": "high" },
  },
}
```

Invalid options fail fast at setup so misconfiguration is visible instead of
silently ignored. Any routing failure at request time falls back to the
agent's configured model variant and never breaks dispatch.

## Known limitation

The hook changes the effective OpenAI request, not the variant shown in
session metadata. `reasoning_router_status` reports the effective effort.

## Compatibility

V2-only. `@opencode-ai/plugin` is pinned to `0.0.0-beta-19157`, the exact
build matching the installed OpenCode release (`opencode2
v0.0.0-beta-19157`). Test the installed package — not only a workspace
import — after any OpenCode or plugin-API upgrade, because the V2 API is beta.

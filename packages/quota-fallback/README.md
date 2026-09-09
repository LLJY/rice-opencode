# quota-fallback (V2-only)

Configurable quota-triggered model failover. A session `retry` hook watches
provider failures; on quota/rate-limit errors it switches the session to the
first applicable fallback model and schedules the retry on the fresh model.

## Install

```sh
opencode2 plugin add 'github:hoshinoht/rice-opencode#v2::path:packages/quota-fallback'
```
A per-session circuit breaker stops failover loops. Any other error type is
left to OpenCode's native retry policy untouched.

There is deliberately no switch-back: the session stays on the fallback until
the operator switches it back or the session ends.

## Per-agent preference: `fallback-model`

Each agent prompt can declare its own preferred fallback directly below its
`model:` line:

```yaml
model: openai/gpt-5.6-sol#high
# fallback-model: opencode/muse-spark-1.3-contributor-free#high
```

Rules:

- Same `provider/model[#variant]` syntax as `model:`, including the reasoning
  variant — mirror the agent's own tier (`#medium`, `#high`, `#xhigh`) so
  failover preserves its cost/quality band. All three variants were verified
  live against `muse-spark-1.3-contributor-free`; only use a variant the
  target model actually accepts.
- The `#` comment prefix is required: a bare key would leak into OpenCode
  request bodies. The plugin reads the raw file and ignores bare keys.
- Precedence on a quota error: agent directive first, then the shared
  `fallbacks` chain. An invalid, excluded, or unreadable directive warns and
  falls through to the chain.
- Agent files resolve from the plugin location (`agents/<id>.md` under the
  project directory, then the config directory). Directives in other
  checkouts are not read — use plugin options for those.

## Options (`opencode.json`)

```jsonc
{
  "package": "./packages/quota-fallback",
  "options": {
    "enabled": true, // master switch
    "retryDelayMs": 2000, // 0..120000, delay for the retry after a switch
    "maxSwitchesPerSession": 1, // 0..5, circuit breaker (0 disables switching)
    "fallbacks": [
      // First match wins. `agents` omitted = all agents.
      { "agents": ["oracle", "plan"], "model": { "providerID": "opencode", "id": "muse-spark-1.3-contributor-free" } },
      { "model": { "providerID": "opencode", "id": "muse-spark-1.3-contributor-free" } },
    ],
  },
}
```

`maxSwitchesPerSession: 0` disables switching while keeping the plugin loaded.
`enabled: false` requires no `fallbacks`; any other invalid config fails fast
at setup.

## What counts as quota exhaustion

Deliberately tight so real failures are never masked by a model switch:

- `status === 429`, or
- error `type` matching rate-limit/quota/capacity/insufficient/too-many-requests, or
- error `message` matching quota/rate-limit/429/usage-limit/overloaded/billing/credit/exhausted.

Auth (401/403), validation (400), and server (5xx) errors never trigger a
switch.

## Safety rules

- A model that already failed quota in a session is never selected again
  (no A→B→A ping-pong).
- At most `maxSwitchesPerSession` switches per session; afterwards the native
  retry decision stands.
- If `switchModel` itself fails, the native decision stands and nothing is recorded.
- The handler never throws; any unexpected failure keeps native behavior.

## Diagnostics

Each switch logs one line and appends a record without prompt content:

```text
quota_fallback_status { "sessionID": "ses_abc", "limit": 20 }
```

## Compatibility

V2-only. `@opencode-ai/plugin` is pinned to `0.0.0-beta-19157`, matching the
installed OpenCode release. Re-test after any OpenCode or plugin-API upgrade.

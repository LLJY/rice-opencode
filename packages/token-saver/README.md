# token-saver (V2-only)

Token metering, output slimming, and (gated) pruning for OpenCode sessions.
Each pattern toggles independently; everything fails open and never breaks
dispatch. Only sizes are stored — never prompt content or tool results.

## Install

```sh
opencode2 plugin add 'github:hoshinoht/opencode-config#main::path:packages/token-saver'
```

Or register the local path in `opencode.json`:

```jsonc
{
  "plugins": [
    { "package": "./packages/token-saver" },
  ],
}
```

## Patterns

| Pattern | Hook | Default | Status |
|---|---|---|---|
| `meter` | `tool.hook("execute.after")` + `token_saver_status` tool | on | implemented |
| `slimmer` | `tool.transform` description rewrite + result compaction | off | implemented, awaiting live validation |
| `pruner` | `session.hook("context")` pruning with protected list | off | gated on meter data |

Estimates use a chars/4 heuristic (`estimateTokens`), recorded per
session+tool with call/error counts. Query with:

```text
token_saver_status { "sessionID": "ses_abc", "limit": 20 }
```

## Options (`opencode.json`)

```jsonc
{
  "package": "./packages/token-saver",
  "options": {
    "diagnosticsLimit": 100,
    "patterns": { "meter": true, "slimmer": false, "pruner": false },
    "maxResultChars": 12000,
  },
}
```

Invalid options fail fast at setup. Runtime hook failures log a warning and
record nothing.

## Compatibility

V2-only. `@opencode-ai/plugin` is pinned to `0.0.0-beta-19157`, the exact
build matching the installed OpenCode release. Test the installed package —
not only a workspace import — after any OpenCode or plugin-API upgrade,
because the V2 API is beta.

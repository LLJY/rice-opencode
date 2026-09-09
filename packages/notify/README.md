# notify (V2-only)

ntfy push notifications for OpenCode session execution events. Event-driven:
no tools added, no prompts injected, zero context cost. Every failure path
logs a warning and continues — a notifier never breaks sessions.

Notifies on `session.execution.succeeded` (agent finished, waiting for input)
and `session.execution.failed` (with the error message). There is no
permission event in the V2 API (verified in client `api.d.ts`), so
permission-asked notifications are unsupported until the API exposes one.

## Install

```sh
opencode2 plugin add 'github:hoshinoht/opencode-config#main::path:packages/notify'
```

Or register the local path in `opencode.json`, then set your topic:

```jsonc
{
  "package": "./packages/notify",
  "options": {
    "topic": "my-opencode-notifications",
  },
}
```

With no topic configured the plugin logs a warning and stays disabled.

## Options (`opencode.json`)

```jsonc
{
  "package": "./packages/notify",
  "options": {
    "enabled": true,
    "server": "https://ntfy.sh",
    "topic": "my-opencode-notifications",
    "token": "tk_mytoken", // optional, for authenticated/self-hosted servers
    "events": { "succeeded": true, "failed": true },
    "timeoutMs": 8000, // 1000..60000
  },
}
```

Invalid options fail fast at setup. Delivery failures (network, non-2xx)
log a warning per attempt.

## Compatibility

V2-only. `@opencode-ai/plugin` is pinned to `0.0.0-beta-19157`, the exact
build matching the installed OpenCode release. Test the installed package —
not only a workspace import — after any OpenCode or plugin-API upgrade,
because the V2 API is beta.

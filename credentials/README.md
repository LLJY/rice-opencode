# Credential files

Rice never stores API-key values in the repository or requires environment variables for its keyed MCP integrations.

Default files:

```text
~/.config/opencode/.github-pat
~/.config/opencode/.context7-api-key
~/.config/opencode/.exa-api-key
```

Each file contains only the corresponding key, optionally followed by a newline. Use mode `0600`; the containing directory should use mode `0700`.

The plugin reads these files during OpenCode startup and passes the value to the local MCP process through its environment. Secrets are not placed in MCP command-line arguments.

Missing, unreadable, or empty files disable only their corresponding MCP. Keyless MCPs, agents, commands, skills, and workplan tools continue to load.

For an alternate credential directory, use plugin options:

```json
{
  "plugin": [
    ["@rice-opencode/plugin", { "credentialDirectory": "~/.config/opencode" }]
  ]
}
```

The default already points to `~/.config/opencode`; the option is mainly useful for isolated testing or non-standard installations.

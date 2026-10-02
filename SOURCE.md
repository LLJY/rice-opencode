# Corresponding source

Release: v0.2.0
Source commit: 70a37c9526d889e7eefbd4f1c1f269bd5b791ed4

This tag is the prebuilt package at the repository root, not the development
source layout. The GitHub release attaches rice-opencode-source-v0.2.0.tar.gz,
including both pinned MCP submodule source trees, plus zod-4.6.5-source.tgz,
the runtime download, and SHA256SUMS. Automatic GitHub tag archives are runtime
only. Original Go dependency, MCP, Zod and skill license notices are retained.

For a reproducible rebuild use Bun 1.4.2, Go 1.25+ and uv. The build verifies
Git submodule pins, so a Git checkout supplies the required revision metadata:

```sh
git clone https://github.com/LLJY/rice-opencode.git
git -C rice-opencode checkout 70a37c9526d889e7eefbd4f1c1f269bd5b791ed4
git -C rice-opencode submodule update --init --recursive
bun install --cwd rice-opencode --frozen-lockfile
bun run --cwd rice-opencode build
```

The output is rice-opencode/packages/plugin/dist/. The source archive includes
all tracked build inputs and pinned upstream sources for inspection; the lockfiles
record exact dependency versions. Plugin: GPL-2.0-only. Dependency and skill
notices retain their original terms. Runtime users need uv for Hound preparation;
no Go installation is required. Exa requires EXA_API_KEY or an .exa-api-key file.

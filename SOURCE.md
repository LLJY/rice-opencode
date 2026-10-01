# Corresponding source

Release: v0.1.0
Source commit: 6267d23626aad776161926ec237f23c54e955541

This tag is the prebuilt plugin at the repository root. Development source is
on the v2 branch, not in this artifact tree. The GitHub release attaches
rice-opencode-source-v0.1.0.tar.gz and zod-4.6.5-source.tgz (including Zod's src/
and MIT notice), together with the runtime download and SHA256SUMS.

Rebuild the plugin from the source archive with Bun 1.4.2:

```sh
bun install --frozen-lockfile
bun run build
```

The rebuilt output is packages/plugin/dist/. Zod's separate archive supplies the
exact source of the bundled dependency; the source lockfile pins build inputs.
Plugin: GPL-2.0-only. Bundled dependency and skill notices retain their own terms.

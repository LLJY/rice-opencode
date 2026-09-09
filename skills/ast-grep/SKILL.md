---
name: ast-grep
description: Search and rewrite code by AST shape across 25 languages. Use when the target is a syntax pattern (calls, classes, imports, codemods) rather than literal text; for plain strings use rg.
---

# ast-grep

`sg` (also installed as `ast-grep`) is an AST-aware search and rewrite tool.
It treats a pattern as code, parses it like the project, and matches
structurally. Use it when the question depends on code shape, not text bytes.
For string contents, comments, or filenames, use `rg` instead.

This skill ships `scripts/ast_grep_helper.py` (stdlib-only Python wrapper) and
platform installers `install.sh` (POSIX) / `install.ps1` (Windows).
Prefer the helper; drop to `sg` only when the helper cannot express the query.
Full upstream references (patterns, pitfalls, recipes, CLI, YAML rules,
sgconfig, install):
`https://github.com/code-yeongyu/oh-my-openagent/tree/dev/packages/shared-skills/skills/ast-grep`
(pinned dev SHA `b5122f19db107e9ab76be51e2898d699c1b6e755`).

## When to use

- Finding every call, class, import, or statement shaped like X.
- Codemods across many files (e.g. `console.log(x)` to `logger.info(x)`).
- Running reusable YAML lint rules via `sg scan`.
- Switch to `rg` for regex, alternation, character classes, file names.

## Patterns are code, not regex

Wildcards are `$VAR` (one AST node) and `$$$` (zero or more nodes).
Regex syntax fails or misparses — run two searches instead of `foo|bar`,
use `$$$` instead of `.*`, `$VAR` instead of `\w+`, and `rg` instead of
`[a-z]`. Validate before searching:

```bash
python3 skills/ast-grep/scripts/ast_grep_helper.py validate 'console.log($MSG)' --lang ts
```

The helper exits non-zero with a hint on regex misuse and never calls `sg`.

Patterns must parse as valid code: `def $FN($$$)` not `def $FN($$$):`;
`function $NAME($$$) { $$$ }` not a bare `function $NAME`.

## Helper

```bash
# Search
python3 skills/ast-grep/scripts/ast_grep_helper.py search 'console.log($MSG)' --lang ts src/

# Rewrite, dry-run preview (default, mutates nothing)
python3 skills/ast-grep/scripts/ast_grep_helper.py replace 'console.log($MSG)' 'logger.info($MSG)' --lang ts src/

# Rewrite, apply after inspecting the preview
python3 skills/ast-grep/scripts/ast_grep_helper.py replace 'console.log($MSG)' 'logger.info($MSG)' --lang ts src/ --apply

# YAML rules, langs, binary check
python3 skills/ast-grep/scripts/ast_grep_helper.py scan src/
python3 skills/ast-grep/scripts/ast_grep_helper.py langs
python3 skills/ast-grep/scripts/ast_grep_helper.py doctor
```

## Dry-run before apply

Never apply a rewrite without a dry-run preview first: search, dry-run
`replace` without `--apply`, inspect match and file counts, then re-run with
`--apply`.

## Two-pass writes

`--json` and `--update-all` are mutually exclusive: combined, `sg` returns
JSON but mutates nothing. To preview and apply, run two passes:

```bash
sg run -p 'console.log($MSG)' -r 'logger.info($MSG)' --lang ts --json=compact src/
sg run -p 'console.log($MSG)' -r 'logger.info($MSG)' --lang ts --update-all src/
```

The helper's `replace --apply` performs both passes automatically.

## Direct sg

```bash
sg run -p 'console.log($MSG)' --lang ts src/
sg run -p 'console.log($MSG)' -r 'logger.info($MSG)' --lang ts --update-all src/
sg scan src/
```

Always single-quote patterns so the shell does not expand `$VAR`.
Pass `--lang` explicitly with `--stdin`; `sg` cannot infer it from a pipe.

## Binary provisioning

`sg` / `ast-grep` binaries are absent on a fresh machine (deferred setup step).
`doctor` reports this gracefully instead of failing. Install via:

```bash
bash skills/ast-grep/install.sh
```

```powershell
pwsh skills/ast-grep/install.ps1
```

Linux note: prefer `ast-grep` over `sg` because `sg` collides with the
`setgroups` utility. The helper resolves this automatically.

---
name: shell-strategy
description: Use before shell-heavy work to avoid prompts and hangs; prefer non-interactive flags, native file tools, and PTY sessions for long-running processes.
license: MIT
compatibility: opencode
metadata:
  domain: shell
  workflow: non-interactive
---

## Core rules

The shell is non-interactive. Any command that waits for input, opens an editor, opens a pager, or starts a REPL can hang.

- Use non-interactive flags up front: `-y`, `--yes`, `--force`, `--no-input`, `--no-edit`, `--non-interactive`.
- Avoid editors, pagers, REPLs, and menu-driven commands in normal shell calls.
- Prefer native file tools over shell file manipulation.
- Use PTY sessions for dev servers, watch modes, REPLs, prompts, or long-running processes.
- Add explicit timeouts for commands that might unexpectedly prompt or run indefinitely.
- Never stop after a shell output just to wait for the shell to ask something; continue the task or ask the user directly.

## PTY availability

If PTY tools are available, use them instead of normal shell calls for:

- dev servers
- watch modes
- REPLs
- interactive prompts
- long-running processes that should stay alive

Name the session clearly, read output when needed, and clean it up when done.

## Helpful environment variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `CI` | `true` | General CI detection |
| `DEBIAN_FRONTEND` | `noninteractive` | Apt/dpkg prompts |
| `GIT_TERMINAL_PROMPT` | `0` | Git auth prompts |
| `GIT_EDITOR` | `true` | Block git editor |
| `GIT_PAGER` | `cat` | Disable git pager |
| `PAGER` | `cat` | Disable system pager |
| `GCM_INTERACTIVE` | `never` | Git credential manager |
| `HOMEBREW_NO_AUTO_UPDATE` | `1` | Homebrew updates |
| `npm_config_yes` | `true` | NPM prompts |
| `PIP_NO_INPUT` | `1` | Pip prompts |
| `YARN_ENABLE_IMMUTABLE_INSTALLS` | `false` | Yarn lockfile prompts |

## Command patterns

### Package Managers

| Tool | Interactive (BAD) | Non-Interactive (GOOD) |
|------|-------------------|------------------------|
| **NPM** | `npm init` | `npm init -y` |
| **NPM** | `npm install` | `npm install --yes` |
| **Yarn** | `yarn install` | `yarn install --non-interactive` |
| **PNPM** | `pnpm install` | `pnpm install --reporter=silent` |
| **Bun** | `bun init` | `bun init -y` |
| **APT** | `apt-get install pkg` | `apt-get install -y pkg` |
| **APT** | `apt-get upgrade` | `apt-get upgrade -y` |
| **PIP** | `pip install pkg` | `pip install --no-input pkg` |
| **Homebrew** | `brew install pkg` | `HOMEBREW_NO_AUTO_UPDATE=1 brew install pkg` |

### Git Operations

| Action | Interactive (BAD) | Non-Interactive (GOOD) |
|--------|-------------------|------------------------|
| **Commit** | `git commit` | `git commit -m "msg"` |
| **Merge** | `git merge branch` | `git merge --no-edit branch` |
| **Pull** | `git pull` | `git pull --no-edit` |
| **Rebase** | `git rebase -i` | `git rebase` only when non-interactive |
| **Add** | `git add -p` | `git add .` or `git add <file>` |
| **Log** | `git log` | `git --no-pager log -n 10` |
| **Diff** | `git diff` | `git --no-pager diff` |

### System & Files

| Tool | Interactive (BAD) | Non-Interactive (GOOD) |
|------|-------------------|------------------------|
| **RM** | `rm -i file` | `rm -f file` |
| **CP** | `cp -i a b` | `cp -f a b` |
| **MV** | `mv -i a b` | `mv -f a b` |
| **Unzip** | `unzip file.zip` | `unzip -o file.zip` |
| **SSH** | `ssh host` | `ssh -o BatchMode=yes host` |
| **SCP** | `scp file host:` | `scp -o BatchMode=yes file host:` |
| **Curl** | `curl url` | `curl -fsSL url` |
| **Wget** | `wget url` | `wget -q url` |

### Docker

| Action | Interactive (BAD) | Non-Interactive (GOOD) |
|--------|-------------------|------------------------|
| **Run** | `docker run -it image` | `docker run image` |
| **Exec** | `docker exec -it container bash` | `docker exec container cmd` |
| **Build** | `docker build .` | `docker build --progress=plain .` |
| **Compose** | `docker-compose up` | `docker-compose up -d` |

### Python/Node REPLs

| Tool | Interactive (BAD) | Non-Interactive (GOOD) |
|------|-------------------|------------------------|
| **Python** | `python` | `python -c "code"` or `python script.py` |
| **Node** | `node` | `node -e "code"` or `node script.js` |
| **IPython** | `ipython` | Avoid; use `python -c` or a script |

## Avoid in normal shell calls

- **Editors**: `vim`, `vi`, `nano`, `emacs`, `pico`, `ed`
- **Pagers**: `less`, `more`, `most`, `pg`
- **Manual pages**: `man`
- **Interactive git**: `git add -p`, `git rebase -i`, `git commit` without `-m`
- **REPLs**: `python`, `node`, `irb`, `ghci` without script/command mode
- **Interactive shells**: `bash -i`, `zsh -i`

## If a command needs input

```bash
yes | ./install_script.sh
```

```bash
./configure.sh <<EOF
option1
option2
EOF
```

```bash
timeout 30 ./potentially_hanging_script.sh || echo "Timed out"
```

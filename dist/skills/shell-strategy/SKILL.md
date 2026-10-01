---
name: shell-strategy
description: ALWAYS USE before executing shell commands; distro-aware non-interactive shell, package, service, and background-job patterns.
license: MIT
compatibility: opencode
metadata:
  domain: shell
  workflow: non-interactive
---

## Core rules

Always use this skill before executing shell commands.

Always identify the target distro before distro-specific package or service commands. Local workstation is usually Arch Linux; servers are often Debian/Ubuntu; containers and remotes can differ.

- Normal shell calls are non-interactive; avoid editors, pagers, REPLs, and menu prompts.
- Prefer native file/read/search/edit tools over shell for file operations.
- Use `timeout` for finite commands that may hang; use detached `screen`/`tmux` for long-running jobs.
- Do not install/remove system packages, run full system upgrades, or start/stop/enable services unless the user asked.
- Never run `sudo pacman -Sy` without `-u`; avoid partial upgrades.

Check the target OS first:

```bash
cat /etc/os-release
. /etc/os-release && printf 'ID=%s VERSION_ID=%s ID_LIKE=%s\n' "$ID" "$VERSION_ID" "$ID_LIKE"
ssh -o BatchMode=yes host 'cat /etc/os-release'
```

Useful no-prompt prefix:

```bash
CI=true GIT_TERMINAL_PROMPT=0 GIT_EDITOR=true GIT_PAGER=cat PAGER=cat SYSTEMD_PAGER=cat
```

## Arch package patterns

Official repos:

```bash
pacman -Qi package
pacman -Ss '^package$'
sudo pacman -S --needed --noconfirm package
```

System upgrades only when explicitly requested:

```bash
sudo pacman -Syu --noconfirm
```

AUR only when needed and an AUR helper exists:

```bash
command -v paru || command -v yay
paru -S --needed --noconfirm package
```

Prefer official repos over AUR. Do not use `--overwrite`, `-Rdd`, or force flags unless the user explicitly approves the risk.

## Debian/Ubuntu server patterns

Use `apt-get` for scripts and remote servers; set `DEBIAN_FRONTEND=noninteractive` for package changes.

```bash
apt-cache policy package
apt-cache search '^package$'
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y package
```

Server upgrades only when explicitly requested:

```bash
sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
```

Avoid `dist-upgrade`, release upgrades, repository changes, and unattended service restarts unless the user explicitly approves the operational risk.

## Services, logs, processes

Read-only checks:

```bash
systemctl status service --no-pager
systemctl --user status service --no-pager
journalctl -u service --no-pager -n 200
ss -ltnp
ps -ef
```

Start/stop/restart/enable/disable services only when requested. Prefer graceful termination: `kill PID`, then escalate only if needed.

## Project command patterns

Use repo-native scripts first. Prefer Bun and uv where available.

```bash
bun install --frozen-lockfile
bun run build
bun test
uv sync
uv run pytest
npm ci --yes
docker compose up -d
docker compose logs --no-color service
```

Git must not open editors or pagers:

```bash
git --no-pager status --short
git --no-pager diff
git commit -m "message"
git merge --no-edit branch
```

Avoid `git add -p`, `git rebase -i`, and `git commit` without `-m`.

## Background jobs with screen/tmux

Use detached sessions for dev servers, watch modes, workers, or long tests when realtime output is not critical. Name sessions clearly, log to a stable file, inspect logs only when needed, and clean up explicitly.

Prefer `screen`:

```bash
screen -dmS dev-server bash -lc 'bun run dev > /tmp/dev-server.log 2>&1'
screen -ls
tail -n 80 /tmp/dev-server.log
screen -S dev-server -X stuff $'\003'
screen -S dev-server -X stuff $'status\n'
screen -S dev-server -X quit
```

Use `tmux` if `screen` is unavailable or the repo already uses it:

```bash
tmux new-session -d -s dev-server 'bun run dev > /tmp/dev-server.log 2>&1'
tmux list-sessions
tmux capture-pane -pt dev-server
tmux send-keys -t dev-server C-c
tmux send-keys -t dev-server 'status' Enter
tmux kill-session -t dev-server
```

## If a command needs input

Prefer non-interactive flags. Use piped input or heredocs only when the answers are known and safe:

```bash
yes | ./install_script.sh
./configure.sh <<EOF
option1
option2
EOF
timeout 30 ./potentially_hanging_script.sh || true
```

#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Ask Codex to read what I wrote in my vault (through the Infinite Brain MCP
# endpoint) and write today's briefing and the schedule back as notes:
# 브리핑/<date>.md and 브리핑/일정.md. Run by a Windows scheduled task.
#
# Needs: the server up (server-run.sh), `codex` signed in under ~/.codex, and
# ~/.config/infinite-brain/token plus the Codex registration (mcp-setup.sh).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/infinite-brain"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/infinite-brain"
# The server's .env is the one place the port is set.
PORT="${PORT:-$(sed -n 's/^PORT=//p' "$REPO/app/apps/server/.env" 2>/dev/null | tail -1)}"
PORT="${PORT:-3010}"
mkdir -p "$STATE/briefings"
exec >>"$STATE/briefing.log" 2>&1
echo "[$(date -Is)] briefing starting"

for _ in $(seq 1 90); do
  curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 2
done
curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null || { echo "server not answering on :$PORT"; exit 1; }
[ -f "$CONF/token" ] || { echo "missing $CONF/token: run scripts/personal/mcp-setup.sh"; exit 1; }
export IB_MCP_TOKEN="$(cat "$CONF/token")"

export PATH="$HOME/.local/bin:$PATH"
TODAY="$(date +%F)"
prompt="$(sed \
  -e "s/{{TODAY}}/$TODAY/g" \
  -e "s/{{WEEKDAY}}/$(LC_ALL=ko_KR.UTF-8 date +%A 2>/dev/null || date +%A)/g" \
  -e "s/{{NOW}}/$(date +%H:%M)/g" \
  -e "s/{{SINCE}}/$(date -d '1 day ago' -Is)/g" \
  -e "s/{{MONTH}}/$(date +%-m)월/g" \
  "$REPO/scripts/personal/briefing-prompt.md" | grep -v '^<!--')"

# Only tools that add or edit in place: no delete, move or whole-note replace
# (Codex asks approval for those, and nobody is there to give it). The token has
# no notes:delete scope either.
enabled='["list_vaults","list_folders","list_notes","read_note","search_notes","create_folder","create_note","edit_note","append_note"]'

# A neutral cwd keeps this repo's AGENTS.md and project config out of the run.
cd "$STATE"
CODEX_HOME="$HOME/.codex" codex exec --skip-git-repo-check --ephemeral \
  --sandbox read-only -C "$STATE" \
  -c "mcp_servers.infinite-brain.enabled_tools=$enabled" \
  -o "$STATE/briefings/$TODAY.txt" \
  "$prompt"
echo "[$(date -Is)] briefing done"

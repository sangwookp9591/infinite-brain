#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Run the Infinite Brain server for one person on this machine.
#
#   server-run.sh install   install and start the systemd user service once.
#   server-run.sh           start the server through that service. From a
#                           terminal it prints the status and returns. Without
#                           a terminal (the hidden wsl.exe at Windows logon) it
#                           then waits forever, so the WSL VM stays up.
#
# The service runs this script with IB_SERVER_FOREGROUND=1, which does the real
# work in the foreground. systemd restarts it when it fails and starts it again
# whenever the WSL VM boots, including after `wsl --shutdown`, so the server no
# longer depends on a Windows logon to come back.
#
# Without the service installed it falls back to running the server in the
# foreground here, as before.
#
# Safe to run again: Postgres comes up only if it is down, migrations skip what
# is applied, and a server already answering /health makes this exit 0.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER="$REPO/app/apps/server"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/infinite-brain"
LOG="$STATE/server.log"
UNIT="infinite-brain-server.service"
# The server's .env is the one place the port is set.
PORT="${PORT:-$(sed -n 's/^PORT=//p' "$SERVER/.env" 2>/dev/null | tail -1)}"
PORT="${PORT:-3010}"
mkdir -p "$STATE"

if [ "${1:-}" = install ]; then
  mkdir -p "$HOME/.config/systemd/user"
  cat >"$HOME/.config/systemd/user/$UNIT" <<EOF
[Unit]
Description=Infinite Brain server (personal)
StartLimitIntervalSec=0

[Service]
Environment=IB_SERVER_FOREGROUND=1
ExecStart=$REPO/scripts/personal/server-run.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT"
  loginctl enable-linger "$USER" 2>/dev/null || echo "warning: could not enable linger; the service starts only with a WSL session"
  echo "installed $UNIT; log: $LOG"
  exit 0
fi

if [ "${IB_SERVER_FOREGROUND:-}" != 1 ] && systemctl --user is-enabled -q "$UNIT" 2>/dev/null; then
  systemctl --user start "$UNIT"
  if [ -t 1 ]; then
    for _ in $(seq 1 30); do
      curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null && break
      sleep 1
    done
    if curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null; then
      echo "server running on :$PORT ($UNIT)"
    else
      echo "server still starting or failing; check: systemctl --user status $UNIT"
    fi
    echo "log:  tail -f $LOG"
    echo "stop: systemctl --user stop $UNIT"
    exit 0
  fi
  # Started without a terminal by the hidden wsl.exe at Windows logon.
  exec sleep infinity
fi

[ -t 1 ] && echo "running in the foreground; output goes to $LOG (Ctrl+C stops the server)"
exec >>"$LOG" 2>&1
echo "[$(date -Is)] server-run starting"

if curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "server already running on :$PORT"
  exit 0
fi

cd "$SERVER"
# Right after Windows logon the WSL VM is booting and dockerd may not be up yet.
for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 1; done
docker compose up -d postgres
for _ in $(seq 1 60); do
  docker exec context-pg pg_isready -U context -d context -q && break
  sleep 1
done

[ -f dist/index.js ] || { echo "dist/ missing: run 'pnpm run build' in $SERVER"; exit 1; }
node dist/db/migrate.js
exec node dist/index.js

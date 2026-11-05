#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Run the Infinite Brain server for one person on this machine, in the
# foreground, so whatever launched it (a hidden wsl.exe at Windows logon) keeps
# the WSL VM alive for as long as the server runs.
#
# Safe to run again: Postgres comes up only if it is down, migrations skip what
# is applied, and a server already answering /health makes this exit 0.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER="$REPO/app/apps/server"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/infinite-brain"
PORT="${PORT:-3010}"
mkdir -p "$STATE"
exec >>"$STATE/server.log" 2>&1
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

#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Connect my AI to my vault: sign in to the local server, mint an MCP token
# (read + write, no delete) for one vault, save it to
# ~/.config/infinite-brain/token (mode 600), and register the server with Codex
# as `infinite-brain`, reading the token from $IB_MCP_TOKEN. Claude Code is not
# registered: this machine's managed policy allows only company MCP servers.
#
# Usage: mcp-setup.sh <email> [vault name]
# The password is read from IB_PASSWORD or prompted. Rerunning mints a fresh
# token and replaces the saved one; revoke old ones in Vault settings → AI connections.
set -euo pipefail

EMAIL="${1:?usage: mcp-setup.sh <email> [vault name]}"
VAULT_NAME="${2:-}"
BASE="${IB_SERVER:-http://localhost:3010}"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/infinite-brain"
PASSWORD="${IB_PASSWORD:-}"
[ -n "$PASSWORD" ] || { read -rsp "Password for $EMAIL: " PASSWORD; echo; }

jar="$(mktemp)"; trap 'rm -f "$jar"' EXIT
req() { curl -sf -c "$jar" -b "$jar" -H "Content-Type: application/json" -H "Origin: $BASE" "$@"; }

req "$BASE/api/auth/sign-in/email" \
  -d "$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$EMAIL" "$PASSWORD")" >/dev/null \
  || { echo "sign-in failed for $EMAIL" >&2; exit 1; }

org="$(req "$BASE/api/auth/organization/list" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const orgs=JSON.parse(d), want=process.argv[1];
    const pick = want ? orgs.find(o=>o.name===want) : orgs.length===1 ? orgs[0] : null;
    if (!pick) { console.error("vaults: "+orgs.map(o=>o.name).join(", ")+(want?"":"  (name one)")); process.exit(1); }
    console.log(pick.id);
  })' "$VAULT_NAME")"
req "$BASE/api/auth/organization/set-active" -d "{\"organizationId\":\"$org\"}" >/dev/null

token="$(req "$BASE/api/mcp/tokens" -d '{"name":"Codex (this PC)","scopes":["notes:read","notes:write"]}' \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).token))')"
[[ "$token" == mcp_* ]] || { echo "token mint failed" >&2; exit 1; }

mkdir -p "$CONF"; chmod 700 "$CONF"
(umask 077; printf '%s' "$token" > "$CONF/token")

# Shells (and Codex started from them) get the token from this one file.
line='[ -r "${XDG_CONFIG_HOME:-$HOME/.config}/infinite-brain/token" ] && export IB_MCP_TOKEN="$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/infinite-brain/token")"'
for rc in "$HOME/.zshenv" "$HOME/.profile"; do
  grep -qF 'infinite-brain/token' "$rc" 2>/dev/null || printf '\n%s\n' "$line" >> "$rc"
done

export PATH="$HOME/.local/bin:$PATH"
# The default home is what scheduled runs use; a launcher may point CODEX_HOME elsewhere.
homes=("$HOME/.codex")
[ -n "${CODEX_HOME:-}" ] && [ "$CODEX_HOME" != "$HOME/.codex" ] && homes+=("$CODEX_HOME")
for home in "${homes[@]}"; do
  CODEX_HOME="$home" codex mcp remove infinite-brain >/dev/null 2>&1 || true
  CODEX_HOME="$home" codex mcp add infinite-brain --url "$BASE/api/mcp" --bearer-token-env-var IB_MCP_TOKEN >/dev/null
done
echo "connected: token ${token:0:8}… saved to $CONF/token; registered with Codex (${homes[*]}) as infinite-brain"

#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Sign an Office-runtime macOS app and create a signed DMG.
# Usage: APPLE_SIGNING_IDENTITY='Developer ID Application: …' \
#   app/scripts/sign-office-app.sh "/path/Infinite Brain.app" "/path/output.dmg"
# Set DRY_RUN=1 to inspect an app copy without signing or creating a DMG.
set -euo pipefail

identity=${APPLE_SIGNING_IDENTITY:-'Developer ID Application: SangWook Park (QRW9X3848W)'}
app=${1:?Usage: sign-office-app.sh /path/App.app /path/output.dmg}
dmg=${2:?Usage: sign-office-app.sh /path/App.app /path/output.dmg}
dry_run=${DRY_RUN:-0}

[[ "$app" == *.app && -d "$app" ]] || { echo "APP must be an existing .app directory: $app" >&2; exit 2; }
[[ "$dry_run" == 0 || "$dry_run" == 1 ]] || { echo 'DRY_RUN must be 0 or 1' >&2; exit 2; }
app=$(cd "$app" && pwd -P)

tmp=$(mktemp -d "${TMPDIR:-/tmp}/sign-office-app.XXXXXX")
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

is_macho() {
  local kind
  kind=$(file -b "$1" 2>/dev/null || true)
  [[ "$kind" == *Mach-O* ]]
}

list_machos() {
  local root=$1 path
  while IFS= read -r -d '' path; do
    if is_macho "$path"; then printf '%s\0' "$path"; fi
  done < <(find "$root" -type f \( -perm -111 -o -name '*.dylib' -o -name '*.node' -o -name '*.so' \) -print0)
}

has_runtime_timestamp_authority() {
  local details=$1
  grep -q '^Authority=Developer ID Application:' <<<"$details" &&
    grep -q '^Runtime Version=' <<<"$details" &&
    grep -q '^Timestamp=' <<<"$details"
}

entitlements_have_get_task_allow() {
  local target=$1 entfile
  entfile="$tmp/entitlements.$RANDOM.plist"
  if codesign -d --entitlements :- "$target" >"$entfile" 2>/dev/null; then
    /usr/libexec/PlistBuddy -c 'Print :com.apple.security.get-task-allow' "$entfile" >/dev/null 2>&1
  else
    return 1
  fi
}

if [[ "$dry_run" == 1 ]]; then
  echo "DRY_RUN: inspect only: $app"
  count=0
  while IFS= read -r -d '' path; do
    count=$((count + 1))
    details=$(codesign -dvv "$path" 2>&1 || true)
    if has_runtime_timestamp_authority "$details"; then
      printf 'OK signed: %s\n' "${path#"$app"/}"
    else
      printf 'NEEDS SIGNING: %s\n' "${path#"$app"/}"
    fi
    if entitlements_have_get_task_allow "$path"; then
      printf 'FAIL get-task-allow present: %s\n' "${path#"$app"/}"
    fi
  done < <(list_machos "$app")
  echo "DRY_RUN: inspected $count Mach-O files; no files changed and no DMG created."
  exit 0
fi

[[ -n "$identity" ]] || { echo 'APPLE_SIGNING_IDENTITY must not be empty' >&2; exit 2; }
[[ ! -e "$dmg" ]] || { echo "Output already exists: $dmg" >&2; exit 2; }

while IFS= read -r -d '' path; do
  details=$(codesign -dvv "$path" 2>&1 || true)
  if ! has_runtime_timestamp_authority "$details"; then
    codesign --force --options runtime --timestamp --sign "$identity" "$path"
  fi
done < <(list_machos "$app")

while IFS= read -r -d '' node; do
  entitlements="$tmp/node-entitlements.plist"
  cat >"$entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict></plist>
PLIST
  codesign --force --options runtime --timestamp --sign "$identity" --entitlements "$entitlements" "$node"
  # A node that cannot run on this Mac (the x64 slice without Rosetta) is checked by
  # its signature and architecture instead; one that can run must start.
  node_arch="$(lipo -archs "$node" 2>/dev/null || true)"
  case "$(uname -m)" in arm64) host_arch=arm64 ;; *) host_arch=x86_64 ;; esac
  if [[ " $node_arch " == *" $host_arch "* ]]; then
    "$node" -e 'process.exit(0)'
  else
    echo "skip run check for $node ($node_arch cannot run on $host_arch); verifying its signature instead"
    codesign --verify --strict "$node"
  fi
done < <(find "$app/Contents/Resources/office-runtime" -type f -path '*/node' -print0)

app_entitlements="$tmp/app-entitlements.plist"
if codesign -d --entitlements :- "$app" >"$app_entitlements" 2>/dev/null && [[ -s "$app_entitlements" ]]; then
  codesign --force --options runtime --timestamp --sign "$identity" --entitlements "$app_entitlements" "$app"
else
  codesign --force --options runtime --timestamp --sign "$identity" "$app"
fi
codesign --verify --deep --strict "$app"

stage="$tmp/stage"
mkdir -p "$stage/Applications"
ln -s /Applications "$stage/Applications/Applications"
ditto "$app" "$stage/$(basename "$app")"
mkdir -p "$(dirname "$dmg")"
hdiutil create -volname 'Infinite Brain' -srcfolder "$stage" -format UDZO "$dmg"
codesign --force --timestamp --sign "$identity" "$dmg"

while IFS= read -r -d '' path; do
  if entitlements_have_get_task_allow "$path"; then
    echo "get-task-allow entitlement remains: $path" >&2
    exit 1
  fi
done < <(list_machos "$app")
echo "Signed app and DMG: $dmg"

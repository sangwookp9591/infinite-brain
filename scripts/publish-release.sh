#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Publish what scripts/build-installers.sh left in dist/<version>/ as the
# GitHub release v<version>, together with the latest.json the in-app updater
# polls (tauri.conf.json → plugins.updater.endpoints). Installed apps pick the
# release up on their next check (launch, or every 15 minutes), install it in
# the background and show this version's RELEASE_NOTES.md section in What's New.
#
#   scripts/publish-release.sh          # dry run: print latest.json and the upload list
#   scripts/publish-release.sh --yes    # create the release (goes live immediately)
#
# ALLOW_UNNOTARIZED=1 publishes a .dmg that is not stapled (users get a
# Gatekeeper prompt on first open).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/app/apps/desktop/src-tauri/tauri.conf.json"
VERSION="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$CONF")"
DIST="$ROOT/dist/$VERSION"
STAGE="$DIST/release"
REPO="sangwookp9591/infinite-brain"
TAG="v$VERSION"
GO="${1:-}"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
[ -d "$DIST" ] || die "no $DIST — run scripts/build-installers.sh first"

dmg="$(ls "$DIST"/*.dmg 2>/dev/null | head -1 || true)"
mac_tar="$(ls "$DIST"/*.app.tar.gz 2>/dev/null | head -1 || true)"
exe="$(ls "$DIST"/*-setup.exe 2>/dev/null | head -1 || true)"
[ -n "$dmg$exe" ] || die "no installers in $DIST"
[ -z "$dmg" ] && echo "! no .dmg — macOS will not be in this release"
[ -z "$exe" ] && echo "! no setup.exe — Windows will not be in this release"
for f in "$mac_tar" "$exe"; do
  [ -z "$f" ] || [ -f "$f.sig" ] || die "missing updater signature $f.sig"
done
if [ -n "$dmg" ] && [ "${ALLOW_UNNOTARIZED:-0}" != "1" ]; then
  xcrun stapler validate "$dmg" >/dev/null 2>&1 || die "$dmg is not notarized+stapled (ALLOW_UNNOTARIZED=1 to publish anyway)"
fi

# A build that raced another build can embed half a frontend and still "succeed":
# the 0.2.1 Windows installer came out at 18 MB beside 31 MB for 0.2.0. Refuse a
# file that is far smaller than the same kind in the latest release.
check_size() {
  local file="$1" ext="$2" prev new
  [ -n "$file" ] || return 0
  prev="$(gh api "repos/$REPO/releases/latest" --jq "[.assets[] | select(.name | endswith(\"$ext\")) | .size] | first // 0" 2>/dev/null || echo 0)"
  new="$(stat -f %z "$file")"
  if [ "${prev:-0}" -gt 0 ] && [ "$((new * 100 / prev))" -lt 60 ] && [ "${ALLOW_SIZE_DROP:-0}" != "1" ]; then
    die "$(basename "$file") is $((new / 1048576)) MB, only $((new * 100 / prev))% of the latest release's $((prev / 1048576)) MB. Rebuild it, or ALLOW_SIZE_DROP=1 if the drop is real."
  fi
}
check_size "$dmg" ".dmg"
check_size "$exe" "-setup.exe"

# GitHub turns spaces in asset names into dots; stage space-free names so the
# URLs in latest.json are exactly the uploaded names.
rm -rf "$STAGE"; mkdir -p "$STAGE"
stage() { local src="$1" name="$2"; [ -z "$src" ] && return 0; cp "$src" "$STAGE/$name"; [ -f "$src.sig" ] && cp "$src.sig" "$STAGE/$name.sig"; return 0; }
stage "$dmg" "Infinite-Brain_${VERSION}_universal.dmg"
stage "$mac_tar" "Infinite-Brain_${VERSION}_universal.app.tar.gz"
stage "$exe" "Infinite-Brain_${VERSION}_x64-setup.exe"

python3 - "$ROOT/docs/RELEASE_NOTES.md" "$VERSION" "$STAGE" "https://github.com/$REPO/releases/download/$TAG" <<'PY'
import json, os, re, sys, datetime
notes_path, version, stage, base = sys.argv[1:]
# This version's "## <version>" section, minus the authoring comment — the same
# rule the release workflow applies. No section → a silent update (no What's New).
text = open(notes_path, encoding="utf-8").read() if os.path.exists(notes_path) else ""
text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
m = re.search(rf"^## {re.escape(version)}[ \t]*\n(.*?)(?=^## |\Z)", text, flags=re.S | re.M)
body = m.group(1).strip() if m else ""
if not body:
    body = "See the assets below to download and install this version.\n<!-- infinitebrain:silent -->"
open(os.path.join(stage, "notes.md"), "w", encoding="utf-8").write(body + "\n")

def entry(name):
    p = os.path.join(stage, name)
    if not os.path.exists(p):
        return None
    return {"signature": open(p + ".sig", encoding="utf-8").read().strip(), "url": f"{base}/{name}"}

platforms = {}
mac = entry(f"Infinite-Brain_{version}_universal.app.tar.gz")
if mac:  # one universal bundle serves both architectures
    for k in ("darwin-aarch64", "darwin-x86_64", "darwin-aarch64-app", "darwin-x86_64-app"):
        platforms[k] = mac
win = entry(f"Infinite-Brain_{version}_x64-setup.exe")
if win:
    for k in ("windows-x86_64", "windows-x86_64-nsis"):
        platforms[k] = win
latest = {
    "version": version,
    "notes": body,
    "pub_date": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "platforms": platforms,
}
json.dump(latest, open(os.path.join(stage, "latest.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
PY

(cd "$STAGE" && shasum -a 256 *.dmg *.exe 2>/dev/null > SHA256SUMS.txt || true)

echo "== $TAG → github.com/$REPO"
echo "-- latest.json"; cat "$STAGE/latest.json"
echo; echo "-- assets"; ls -lh "$STAGE" | tail -n +2

if [ "$GO" != "--yes" ]; then
  echo; echo "Dry run. Re-run with --yes to create $TAG (installed apps update within 15 minutes)."
  exit 0
fi

gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 && die "$TAG already exists — bump the version instead of overwriting a shipped release"
assets=()
for f in "$STAGE"/*; do [ "$(basename "$f")" = notes.md ] || assets+=("$f"); done
gh release create "$TAG" -R "$REPO" --title "Infinite Brain $TAG" --notes-file "$STAGE/notes.md" "${assets[@]}"
echo "✓ https://github.com/$REPO/releases/tag/$TAG"

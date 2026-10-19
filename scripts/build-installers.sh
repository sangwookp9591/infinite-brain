#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Build the installers on this Mac: a Developer ID signed, notarized and
# stapled universal .dmg, and a Windows NSIS .exe cross-compiled with
# cargo-xwin. Both are copied to dist/<version>/ with SHA-256 sums and the
# updater bundles + signatures. One-time setup is in docs/RELEASE_SIGNING.md.
#
#   scripts/build-installers.sh            # macOS + Windows
#   scripts/build-installers.sh mac        # only the .dmg
#   scripts/build-installers.sh win        # only the .exe
#
# Overrides: APPLE_SIGNING_IDENTITY, NOTARY_PROFILE (default axdb-notary),
# UPDATER_KEY_DIR (default ~/.infinite-brain), SKIP_NOTARIZE=1 (sign only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/app/apps/desktop"
CONF="$DESKTOP/src-tauri/tauri.conf.json"
TARGET_DIR="$DESKTOP/src-tauri/target"
WHAT="${1:-all}"

VERSION="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$CONF")"
NAME="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['productName'])" "$CONF")"
OUT="$ROOT/dist/$VERSION"
mkdir -p "$OUT"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# The updater artifacts (.tar.gz/.zip + .sig) need the minisign key; the
# release workflow and in-app updates verify against tauri.conf.json's pubkey.
KEY_DIR="${UPDATER_KEY_DIR:-$HOME/.infinite-brain}"
[ -f "$KEY_DIR/updater.key" ] || die "updater key not found at $KEY_DIR/updater.key"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_DIR/updater.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$KEY_DIR/updater.key.password" 2>/dev/null || true)"
pub_conf="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['plugins']['updater']['pubkey'])" "$CONF")"
[ "$(tr -d '\n' < "$KEY_DIR/updater.key.pub")" = "$pub_conf" ] || die "updater key does not match the pubkey in tauri.conf.json"

say "Infinite Brain $VERSION → $OUT"
(cd "$ROOT/app" && pnpm install --frozen-lockfile >/dev/null)

build_mac() {
  local identity="${APPLE_SIGNING_IDENTITY:-}"
  if [ -z "$identity" ]; then
    identity="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
  fi
  [ -n "$identity" ] || die "no Developer ID Application identity in the keychain (docs/RELEASE_SIGNING.md §1)"
  export APPLE_SIGNING_IDENTITY="$identity"
  # Notarization is done below with the keychain profile, never by tauri with
  # an Apple ID password.
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER

  say "macOS: universal build, signed as $identity"
  (cd "$DESKTOP" && pnpm tauri build --target universal-apple-darwin --bundles app,dmg)

  local bundle="$TARGET_DIR/universal-apple-darwin/release/bundle"
  local app="$bundle/macos/$NAME.app"
  local dmg
  dmg="$(ls "$bundle/dmg/"*.dmg | head -1)"
  codesign -dvv "$app" 2>&1 | grep -E 'Authority=Developer ID Application|flags=.*runtime' >/dev/null \
    || die "$app is not Developer ID signed with the hardened runtime"

  if [ "${SKIP_NOTARIZE:-0}" != "1" ]; then
    local profile="${NOTARY_PROFILE:-axdb-notary}"
    say "macOS: notarizing the .dmg ($profile)"
    xcrun notarytool submit "$dmg" --keychain-profile "$profile" --wait | tee "$OUT/notary.log"
    grep -q 'status: Accepted' "$OUT/notary.log" || die "notarization was not accepted (see $OUT/notary.log)"
    xcrun stapler staple "$dmg"
    xcrun stapler validate "$dmg"
    spctl -a -vv -t open --context context:primary-signature "$dmg" 2>&1 | tee -a "$OUT/notary.log"
  fi

  cp "$dmg" "$OUT/"
  # Updater bundle for macOS (the in-app updater downloads this, not the .dmg).
  cp "$bundle/macos/"*.app.tar.gz* "$OUT/" 2>/dev/null || true
}

build_win() {
  command -v cargo-xwin >/dev/null || die "cargo-xwin missing: cargo install cargo-xwin --locked"
  command -v makensis >/dev/null || die "NSIS missing: brew install nsis"
  rustup target list --installed | grep -q x86_64-pc-windows-msvc || rustup target add x86_64-pc-windows-msvc
  export PATH="$(brew --prefix llvm)/bin:$PATH"

  say "Windows: NSIS installer (cross-compiled, unsigned)"
  (cd "$DESKTOP" && pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis)
  cp "$TARGET_DIR/x86_64-pc-windows-msvc/release/bundle/nsis/"*-setup.exe* "$OUT/"
}

case "$WHAT" in
  all) build_mac; build_win ;;
  mac) build_mac ;;
  win) build_win ;;
  *) die "usage: $0 [all|mac|win]" ;;
esac

say "Checksums"
(cd "$OUT" && shasum -a 256 *.dmg *.exe 2>/dev/null | tee SHA256SUMS.txt)
ls -lh "$OUT"

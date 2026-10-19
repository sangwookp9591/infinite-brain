# Changelog

All notable changes to Infinite Brain are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Initial release

#### Added
- **AI connection wizard.** Connect your own Claude or ChatGPT to a vault over MCP, with a
  choice of read-only, read+write or read+write+delete. Connections can be listed and revoked.
  MCP tokens and OAuth grants carry scopes (`notes:read`, `notes:write`, `notes:delete`,
  `access:manage`); a revoked connection gets 401 on its next call.
- **AI change ledger and undo.** MCP note changes are recorded (`ai_change_ledger`) and shown in
  Activity → AI changes with a diff. Undo refuses with 409 if a person has edited the note since.
  Undoing an AI create follows the creator-only delete rule. Entries are kept for
  `AI_CHANGES_RETENTION_DAYS` (90).
- **Invite links.** Join a vault with a link; no email server needed.
- **Galaxy graph.** The graph view draws notes as a spiral galaxy (three.js WebGPU, falling back
  to WebGL2 and then 2D).
- **First-launch intro.** Four motion scenes before the welcome screen: notes as files, live team
  editing, undoable AI edits and the galaxy. Shown once per device, skippable, still under reduced
  motion, and out of the way of invite or shared-note sign-in prompts.
- **English and Korean.** A language setting (System, English, 한국어) in Account settings → Appearance. Untranslated text falls back to English, so Korean grows screen by screen; the sidebar and menus, sign-in, invite and sharing, the sync status, settings tabs, About and the first-launch tour are done.
- **GitHub star ask.** After five days of use a corner card asks once whether to star the repository, and Settings → About always has a Star on GitHub button. It never blocks a note and ends for good after any answer.
- **Glass avatars.** Every avatar sits under a CSS glass layer (lit rim, glare, shade), tuned for
  light and dark and kept in proportion from 16px rows to the profile.
- **Installers.** A Developer ID signed, notarized universal macOS `.dmg` and a Windows NSIS
  `.exe`, built on one Mac (`scripts/build-installers.sh`) and published with the updater's
  `latest.json` (`scripts/publish-release.sh`).

#### Fixed
- **Korean and other non-Latin search.** The server/MCP embedder used to drop every character
  outside `[a-z0-9_]`, so Korean queries scored 0 and returned arbitrary results. It now uses
  Unicode words and bigrams, drops zero-score hits and re-indexes on `embed_version` change.
  Local search adds trigram and filename matching. Korean top-3 hits: 2/10 → 10/10.

#### Changed
- App ID `com.infinitebrain.desktop`, URL scheme `infinitebrain://` (server `DEEP_LINK_SCHEME`
  default too), MCP env var `INFINITE_BRAIN_MCP_TOKEN`.
- Migrations 056–060 are idempotent; boot re-embedding takes an advisory lock.
- The updater signing key is now password-protected; the old unprotected key was retired before
  any release.
- The release workflow builds ad-hoc signed instead of failing when the Apple secrets are absent.


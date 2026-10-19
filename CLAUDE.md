# Infinite Brain development notes

Read this file and the relevant tests before changing code. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture reference. Project docs live under `docs/`.

## Code map

- `app/apps/desktop/src-tauri/`: Rust owns filesystem access, atomic writes, the filesystem watcher, SQLite index, and OS keychain.
- `app/apps/desktop/src/`: React/TypeScript UI, typed Rust IPC, HTTP client, Markdown editor, Yjs bridge, and sync client.
- `app/apps/server/src/`: Hono HTTP API, Hocuspocus sync, Better Auth, Postgres, permissions, blobs, and MCP.

## Invariants

- A stable `doc_id` is note identity across files, SQLite, Yjs, and Postgres. Renames and moves keep the same identity.
- Markdown on disk is durable truth; `Y.Text("content")` is live truth. Rust performs atomic disk writes; UI code uses typed IPC.
- Sync and persistence use binary Yjs updates. Never send Markdown over the note sync protocol.
- Preserve both bridge echo guards: ignore disk-origin changes for egest and suppress ingest matching `lastWrittenHash`. Watcher/ingest stays about 150 ms; egest stays about 300 ms.
- Signed-in startup pulls server state before seeding an empty orphan. Keep deletion, revocation, recovery, and bulk-operation guards that prevent data loss.
- `.context/` is private local metadata. Never include it in user-content walks, sync, or indexing. Keep its identity map and CRDT state compatible; the internal `context` name is intentionally undecided.
- Keep Rust extension lists, the TypeScript format registry, and sync note-extension lists in lockstep. Binary files do not enter the note CRDT pipeline.
- Authorization must agree across the resolver, readable-set listings, HTTP, sync, blobs, and MCP. UI caches never authorize writes.
- Preserve HTML sanitization and packaged-app CSP boundaries.
- Use **vault** in product language. `organizationId` identifies the Better Auth organization; `vaultId` identifies its note collection.

## Feature map (where to look)

- MCP scopes and connections: `app/apps/server/src/mcp/scopes.ts`, `mcp/oauth.ts`, `mcp/tokens.ts`, `http/routes/oauth-connect.ts`; desktop wizard `src/lib/aiConnection.ts`, `src/lib/connectLink.ts`. Scope checks fail closed.
- MCP OAuth audience/CIMD: `mcp/resource.ts`, `mcp/oauth-exchange.ts`, `mcp/cimd.ts`, migration 061. `BETTER_AUTH_URL` is an explicit HTTPS public origin (HTTP loopback for development); only its `/api/mcp` resource is allowed. OAuth grant/token resource and random connection generation must match the current binding. Consent/exchange/revoke serialize under a per-connection PostgreSQL advisory lock. Legacy unbound OAuth tokens require reconnect; manual legacy tokens remain local credentials. CIMD public clients use pinned public-IP HTTPS fetches and exact redirect matching; `MCP_CIMD_ALLOW_PRIVATE_IPS=true` is development-only.
- AI change ledger: `app/apps/server/src/ai-changes/` + `http/routes/ai-changes.ts`, migration 057; contract in `docs/AI-CHANGES.md`. Ledger rows commit in the same transaction as the Yjs update.
- Search: server `src/index/embedder.ts` (Unicode + bigram, `embed_version`, migration 056); desktop trigram/filename search in `src-tauri/src/index.rs`.
- Invite links: `components/InvitePeopleDialog.tsx` builds the link on the existing join-code/invite flow (`src/lib/inviteLink.ts`); onboarding timing in `src/lib/onboardingTimer.ts`.
- Galaxy graph: `src/lib/graph/galaxyLayout.ts`, `galaxyRenderer.ts`, mounted by `components/GraphView.tsx`; preview harness `apps/desktop/dev/graph-galaxy/`.
- First-launch intro: `components/Onboarding.tsx` (+ `.css`), gated by `src/lib/onboardingIntro.ts` (`infinitebrain.onboarding.v1` in localStorage) and mounted by `FirstRunIntro` in `App.tsx` on the welcome branch only; it yields to `authPrompt`. Every visual is a pure function of time and state; preview with `surface=onboarding` in the window simulator.
- What's New card: `components/ChangeSummary.tsx` (+ `.css`, tokens only) shows one row per release-note line; `releaseChange()` in `lib/releaseNotes.ts` splits a `Label: change` line, and a line without a label shows under "New". Write release notes that way (see the rules at the top of `docs/RELEASE_NOTES.md`). The window is `.modal.whats-new`: the plain `.whats-new` selector loses to the generic `.modal` width.
- GitHub star ask: policy in `src/lib/starPrompt.ts` (counts distinct days, asks once, any answer is final, unreadable storage means never ask), card in `components/StarPrompt.tsx` mounted in the main shell, permanent button in Settings → About. The button is `components/kit/PulseStar.tsx` (shrink-flip-rebound, adapted from React Bits Pulse Heart; it opens `REPO_URL` through `ipc.openExternal` only after the animation ends).
- UI language (English, Korean): `src/lib/i18n/index.ts` (+ `ko.ts`). The English text is the key, `t("…")` / `useT()`; a string with no Korean entry shows in English, so screens are translated one at a time. Choice is System/English/한국어 in localStorage `infinitebrain.locale`, set in Account settings → Appearance; `html[lang]` follows it. Translated so far: settings tabs and About, the star card, the first-launch intro, sidebar/file tree/menus, sign-in, invite and sharing, app banners and the sync pill. Not yet: vault settings, health, housekeeper, billing/upgrade. The dictionary is one file per area under `src/lib/i18n/ko/`; a key may live in only one file. To translate a screen, wrap its text in `t()`/`useT()` and add the pair to that area's file (keep 해요체; `i18n.test.ts` checks placeholders).
- Avatar glass: `.glass-face` in `App.css`, added by `Avatar` and `FaceSvg` in `components/Avatar.tsx`. CSS only (container units, per-theme variables); WKWebView has no backdrop displacement, so do not swap in SVG/WebGL refraction.
- Installers and updates: `scripts/build-installers.sh` (signed + notarized universal `.dmg`, cargo-xwin NSIS `.exe` into `dist/<version>/`) and `scripts/publish-release.sh` (`latest.json` from the `.sig` files and the version's `docs/RELEASE_NOTES.md` section, then `gh release create`). Guide: `docs/RELEASE_SIGNING.md`; the Actions path is `docs/RELEASE.md`. Asset names are space-free (`Infinite-Brain_<v>_universal.dmg`, `…_x64-setup.exe`) because the portfolio site (`2DROOM-AING/lib/feeds.ts`) and `latest.json` URLs match on them.
- Implementation reports live in `docs/reports/`; build status in `docs/STATUS.md`.

- Security audit: migration 062 installs row triggers on access/membership/invitation/link/connection tables. Both application and Better Auth pools use `audit/client.ts` to bind AsyncLocalStorage actor/request identity with transaction-local `set_config`. A mutation and its audit row commit or roll back together; missing identity is system/unknown. Never use session-wide SET for request identity, bypass these pools for authorization writes, or log note content/credentials. Explicit `recordAudit(client, entry)` uses the same transaction; refused writes are recorded after rollback. Retention is 365 days by default.

- Guest boundaries: guest grants come only from user folder/file rows. `permissions/guest-http.ts` runs inside response compression and projects canonical paths into shared roots while removing other people metadata; path cursors are authenticated opaque values. Stable document IDs remain identity. Single-item creates map a chosen editable folder ID back to its canonical parent; note/file registration batches reverse projected paths only inside existing editable shared folders (existing readable IDs may be adopted without moving); rename/move and folder writes are refused for guests until the full Q3 path contract is implemented. Bootstrap rechecks access on every page. Raw editor awareness is suppressed for guests; vault presence is scoped and anonymized.

- External revocation: migration 066 stores per-operation counts/errors. Guest acceptance and external grant creation serialize on `external-access:<organizationId>`; each removal and progress/audit update share a transaction. `sync/doc-revocations.ts` mirrors document socket closes over the configured pubsub after commit, in addition to existing ACL/member frames.

## Local gotchas

- Node 25: run desktop vitest with `NODE_OPTIONS=--no-experimental-webstorage`.
- Local macOS app build without the updater key: `pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'` from `app/apps/desktop/`. The release build needs about 4 GB of free disk.
- The updater private key and its password live outside the repo (`~/.infinite-brain/updater.key`, `updater.key.password`). Never commit or print them; `build-installers.sh` refuses to build if the key does not match `tauri.conf.json`'s pubkey.
- Apple notarization uses the team keychain profile `axdb-notary` (shared with AxDB). The notary queue can take far longer than its usual minutes; never reduce `--wait` to a timeout that discards an accepted submission.

## Commands

Run `pnpm install` from `app/`.

- Desktop TypeScript tests: `pnpm test` from `app/apps/desktop/`.
- Desktop Rust checks: `cargo check` or `cargo test` from `app/apps/desktop/src-tauri/`.
- Desktop dev/build: `pnpm run dev:desktop` / `pnpm run build:desktop` from `app/`.
- Server tests can wipe their configured database. Use a dedicated disposable database and never the shared `context` database.

Run the checks relevant to the change and report commands and outcomes. Do not push. Never commit credentials, `.env` files, or updater private keys. New source files use the Apache-2.0 SPDX header.

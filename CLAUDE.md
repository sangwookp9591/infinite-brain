# Infinite Brain development notes

Read this file and the relevant tests before changing code. See [`docs/UPSTREAM-CLAUDE.md`](docs/UPSTREAM-CLAUDE.md) for the inherited architecture reference. Project docs live under `docs/`.

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

## Fork additions (where to look)

- MCP scopes and connections: `app/apps/server/src/mcp/scopes.ts`, `mcp/oauth.ts`, `mcp/tokens.ts`, `http/routes/oauth-connect.ts`; desktop wizard `src/lib/aiConnection.ts`, `src/lib/connectLink.ts`. Scope checks fail closed.
- MCP OAuth audience/CIMD: `mcp/resource.ts`, `mcp/oauth-exchange.ts`, `mcp/cimd.ts`, migration 061. `BETTER_AUTH_URL` is an explicit HTTPS public origin (HTTP loopback for development); only its `/api/mcp` resource is allowed. OAuth grant/token resource and random connection generation must match the current binding. Consent/exchange/revoke serialize under a per-connection PostgreSQL advisory lock. Legacy unbound OAuth tokens require reconnect; manual legacy tokens remain local credentials. CIMD public clients use pinned public-IP HTTPS fetches and exact redirect matching; `MCP_CIMD_ALLOW_PRIVATE_IPS=true` is development-only.
- AI change ledger: `app/apps/server/src/ai-changes/` + `http/routes/ai-changes.ts`, migration 057; contract in `docs/AI-CHANGES.md`. Ledger rows commit in the same transaction as the Yjs update.
- Search: server `src/index/embedder.ts` (Unicode + bigram, `embed_version`, migration 056); desktop trigram/filename search in `src-tauri/src/index.rs`.
- Invite links: `components/InvitePeopleDialog.tsx` builds the link on the existing join-code/invite flow (`src/lib/inviteLink.ts`); onboarding timing in `src/lib/onboardingTimer.ts`.
- Galaxy graph: `src/lib/graph/galaxyLayout.ts`, `galaxyRenderer.ts`, mounted by `components/GraphView.tsx`; preview harness `apps/desktop/dev/graph-galaxy/`.
- Rebrand map: `scripts/rebrand.mjs` (idempotent; `--dry-run` must report 0 files). It skips historical records: `docs/research/`, `docs/reports/`, `docs/FINAL-report.md`, `docs/UPSTREAM-CLAUDE.md`.
- Implementation reports live in `docs/reports/`; fork status in `docs/STATUS.md` (top section).

## Local gotchas

- Node 25: run desktop vitest with `NODE_OPTIONS=--no-experimental-webstorage`.
- Local macOS app build without the updater key: `pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'` from `app/apps/desktop/`. The release build needs about 4 GB of free disk.
- The updater private key lives outside the repo (`~/.infinite-brain/updater.key`). Never commit it.

## Commands

Run `pnpm install` from `app/`.

- Desktop TypeScript tests: `pnpm test` from `app/apps/desktop/`.
- Desktop Rust checks: `cargo check` or `cargo test` from `app/apps/desktop/src-tauri/`.
- Desktop dev/build: `pnpm run dev:desktop` / `pnpm run build:desktop` from `app/`.
- Server tests can wipe their configured database. Use a dedicated disposable database and never the shared `context` database.

Run the checks relevant to the change and report commands and outcomes. Do not push. Never commit credentials, `.env` files, or updater private keys. New source files use the Apache-2.0 SPDX header.

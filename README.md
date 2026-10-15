# Infinite Brain

Infinite Brain is a local-first, collaborative knowledge app. Notes remain plain Markdown files on disk, while a Yjs bridge lets people and connected AI tools edit together in real time.

This independent fork of Baalda 0.1.83 is licensed under Apache-2.0 (the upstream `ee/` directory is not included). See [`NOTICE`](NOTICE) for attribution.

## What this fork adds

| Area | What it does | Docs |
|---|---|---|
| AI connection wizard | Connect your own Claude or ChatGPT to a vault over MCP (OAuth or token). Choose read-only, read+write, or read+write+delete, then review and disconnect connections later. | [`docs/research/W5-mcp-connect.md`](docs/research/W5-mcp-connect.md) |
| Multilingual search | Server and MCP search handle Korean and other non-Latin text (Unicode + bigram embedder, zero-score cutoff, `embed_version` re-index). Local search adds trigram and filename matches. | [`docs/reports/IMPL-REPORT-M2.md`](docs/reports/IMPL-REPORT-M2.md) |
| AI change ledger | Every AI edit is recorded and can be undone. An undo is refused (409) if a person has edited the note since. | [`docs/AI-CHANGES.md`](docs/AI-CHANGES.md) |
| Invite links | Teammates join with a link, no email server needed. | [`docs/onboarding-audit.md`](docs/onboarding-audit.md) |
| Galaxy graph | The graph view renders notes as a spiral galaxy (three.js WebGPU, with WebGL2 and 2D fallbacks). | [`docs/galaxy/`](docs/galaxy/) |
| Rebrand | App ID `com.infinitebrain.desktop`, URL scheme `infinitebrain://`, new icon and updater key. Rerun `node scripts/rebrand.mjs --dry-run` to check for leftovers. | [`docs/BRAND-ASSETS.md`](docs/BRAND-ASSETS.md) |

Design and research: [`docs/FINAL-report.md`](docs/FINAL-report.md) (Korean) and [`docs/research/`](docs/research/). Build status: [`docs/STATUS.md`](docs/STATUS.md). Docs index: [`docs/Infinite Brain.md`](<docs/Infinite Brain.md>).

## Run locally

Requirements: Node.js 22 or newer, pnpm (via Corepack), Rust/Cargo, and Docker (for Postgres).

```sh
cd app
pnpm install

# Server (HTTP :3010, sync WebSocket on the same port at /sync)
cd apps/server
cp .env.example .env        # set a random JWT_SECRET
pnpm run db:up              # Postgres 16 on host port 5439
pnpm run migrate
pnpm run dev

# Desktop (from app/, in another terminal)
pnpm run dev:desktop
```

The desktop defaults to `http://localhost:3010`. You can choose another server in Settings → Connection.

### Build the macOS app locally

```sh
cd app/apps/desktop
pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
open "src-tauri/target/release/bundle/macos/Infinite Brain.app"
```

Turning off `createUpdaterArtifacts` lets you build without the updater signing key. A local build is ad-hoc signed and not notarized. A release build needs about 4 GB of free disk space.

Self-hosting guide: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Test

- Server (`app/apps/server`): `pnpm test`. This wipes the configured database, so point `DATABASE_URL` at a disposable one.
- Desktop TS (`app/apps/desktop`): `pnpm test`. On Node 25 run it with `NODE_OPTIONS=--no-experimental-webstorage`.
- Desktop Rust (`app/apps/desktop/src-tauri`): `cargo test`.

## Data compatibility

The `.context/` vault metadata directory and the internal `context` database/code name stay unchanged to preserve existing data formats. Their future names are undecided.

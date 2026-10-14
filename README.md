# Infinite Brain

Infinite Brain is a local-first, collaborative knowledge app. Notes remain plain Markdown files on disk, while a Yjs bridge lets people and connected AI tools edit together in real time.

This independent fork is licensed under Apache-2.0. The project source and design notes are in [`docs/FINAL-report.md`](docs/FINAL-report.md) and [`docs/research/`](docs/research/). See [`NOTICE`](NOTICE) for attribution.

- AI 변경 원장·되돌리기: [docs/AI-CHANGES.md](docs/AI-CHANGES.md)
- 최종 설계 보고서: [docs/FINAL-report.md](docs/FINAL-report.md)
- 원자료(분석·리서치·검증): [docs/research/](docs/research/)

## Build

Requirements: Node.js 22 or newer, pnpm (via Corepack), and Rust/Cargo.

```sh
cd app
pnpm install
pnpm run dev:desktop
```

Build a desktop installer with `pnpm run build:desktop` from `app/`. The server lives in `app/apps/server`; see [`docs/DEPLOY.md`](docs/DEPLOY.md) for self-hosting.

The desktop currently defaults to `http://localhost:3010`. Start a local server before signing in, or choose another server in Settings → Connection.

## Data compatibility

The `.context/` vault metadata directory and the internal `context` database/code name stay unchanged to preserve existing data formats. Their future names are undecided.

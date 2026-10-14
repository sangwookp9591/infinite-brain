# Contributing to Baalda

Thanks for your interest in improving Baalda! Contributions of all
kinds are welcome: bug reports, docs, tests, and code.

## License of contributions (no CLA)

Baalda is licensed under the **Apache License 2.0**. We do **not**
require a Contributor License Agreement. By submitting a contribution
(a pull request, patch, or otherwise), you agree that your contribution
is provided under the same Apache-2.0 license as the project. This is
the standard GitHub "inbound = outbound" model.

Please only submit work that is your own or that you have the right to
contribute under this license.

A [DCO](https://developercertificate.org/) sign-off is appreciated but
not required. You can add one with `git commit -s`.

## Before you start a large change

For anything beyond a small fix, **open an issue first** so we can align on
approach. Baalda has a deliberate architecture (see below) and some
invariants are load-bearing. A quick discussion saves rework.

## Understanding the codebase

Read these before diving in:

- `CLAUDE.md`: the architectural overview and the invariants that matter.
- `docs/Baalda.md`: the docs index.
- `docs/specs/`: the design specs (source of truth).
- `docs/STATUS.md`: current build state.

Key invariants you must not break (details in `CLAUDE.md`):

- **Identity is `doc_id`, never a path.** Never resolve or store a note by path across layers.
- **The server stores binary Y.Doc only.** Markdown never travels the wire.
- **`.context/` is hidden and sacred.** Never walk, sync, or index it.
- **Debounce timings are load-bearing** (watcher/ingest ~150ms, egest ~300ms).

## Development setup

Prerequisites: Node ≥ 22, Rust/Cargo, Docker. From `app/`, run `npm install` once.

**Server** (from `app/apps/server/`):

```bash
cp .env.example .env      # change JWT_SECRET for anything real
npm run db:up             # Postgres 16 in Docker (host port 5439)
npm run migrate           # apply migrations
npm run dev               # HTTP :3010, sync WS :3011
```

**Desktop** (from `app/`): `npm run dev:desktop`

## Tests must pass

Run the relevant suites before opening a PR:

- Everything: `npm test` from `app/`.
- Server (`app/apps/server`): `npm test` (needs `db:up` + `migrate` first).
  ⚠️ This **wipes the dev DB**, so re-seed afterward.
- Desktop TS (`app/apps/desktop`): `npm test`. The bridge suites (`echo`,
  `concurrent`, `rewrite`, `roundtrip`) gate correctness of the whole product.
- Desktop Rust: `cargo test` in `src-tauri/`.

## Pull request checklist

- [ ] Discussed non-trivial changes in an issue first.
- [ ] Tests pass locally; new behavior has tests.
- [ ] New source files carry the SPDX header:
      `// SPDX-License-Identifier: Apache-2.0`
- [ ] No secrets, credentials, or `.env` files committed.
- [ ] Followed the existing code style of the files you touched.

## Reporting security issues

**Do not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

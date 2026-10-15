# M0 implementation report

## Changes

- Added the idempotent `scripts/rebrand.mjs` with one brand/config object, an explicit tracked-text extension allowlist and exclusions, and `--dry-run` support. Its rules cover product identity, identifiers, deep links, updater URLs, server default, dashboard protocol/SDK, and app HTTP headers.
- Applied the Infinite Brain identity to desktop, server, configs, CI, and product documentation. Production, dev, and staging schemes are `infinitebrain`, `infinitebrain-dev`, and `infinitebrain-staging`; the app uses `com.infinitebrain.app` and the matching keychain service.
- Set the updater to the new GitHub release URLs and installed a newly generated public key. The private key is outside the repository at `~/.infinite-brain/updater.key` with mode `0600`.
- Set the desktop server default to `http://localhost:3010` with a TODO for the future hosted endpoint. The fork reports no managed server until that endpoint is selected.
- Renamed the dashboard URI protocol, SDK route/global/channel, bootstrap content type, version/origin headers, and associated tests. `.context/`, database name `context`, and code name `Context` remain unchanged.
- Rewrote the root README, added a concise fork `CLAUDE.md`, removed the old trademark policy text in favor of a fork notice, and retained Baalda Apache-2.0 attribution in `NOTICE`. No `ee/` directory existed in this worktree.

## Verification

| Check | Result |
|---|---|
| `pnpm install` from `app/` | Passed; dependencies installed, lockfile unchanged |
| `node --test scripts/rebrand.test.mjs` | Passed, 2 tests |
| Rebrand script dry run after application | Passed; 0 files would change |
| Desktop brand-focused Vitest selection | Passed, 221 tests across 16 files |
| `src/__tests__/csp.test.ts` + `src/lib/__tests__/formatsLockstep.test.ts` | Passed, 13 tests across 2 files |
| Server `bootstrap.test.ts` + `polar-email.test.ts` against `infinitebrain_m0_test` | Passed, 21 tests across 2 files; test database was dropped afterward |
| `cargo check` in `app/apps/desktop/src-tauri/` | Passed |
| `git diff --check` | Passed |
| Full desktop `pnpm test` | 311/319 files passed, 6 failed, 2 skipped; 3,443 tests passed, 50 failed, 12 skipped |

The full desktop run reported repeated Node `--localstorage-file` warnings (“provided without a valid path”); 49 failures then stopped in jsdom member-access tests because `localStorage.setItem`/`clear` were unavailable. One folding test also failed in the full run but passed by itself (11/11). The brand-focused runs, including the sync URL cases affected by the endpoint substitution, passed. The full-suite failures remain an environment/test-runner limitation, not a passing result.

Runtime source/config and current product documentation have zero occurrences of the requested old endpoints, owner path, and bundle id. Repository-wide matches are 24 `api.baalda.com`, 11 `naveedharri`, and 31 `com.baalda`: 21/8/27 respectively are in preserved source-history files (`CHANGELOG.md`, `docs/UPSTREAM-CLAUDE.md`, `docs/FINAL-report.md`, and `docs/research/`), while the remainder are the old-value map and test fixture in `scripts/rebrand.mjs` / `scripts/rebrand.test.mjs` plus this report. The script excludes the history and source-map files; imported vendor dashboard templates are also excluded to preserve their upstream notices and metadata.

## Remaining limits

- The updater key was generated with `--ci` and has **no passphrase**. The CLI warned about this; keep the mode-`0600` private key outside the repository and protect its containing account.
- No macOS signed installer, updater publication, or server deployment was performed. `cargo check` validates compilation, not signing or distribution.

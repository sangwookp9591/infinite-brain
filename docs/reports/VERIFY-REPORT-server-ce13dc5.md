# Server verification — `ce13dc5`

Date: 2026-10-17  
Target: `main` HEAD `ce13dc5849ea58f58af3c1e0bd8090c22a4a739f`  
Reviewed range: `c10a7ea..ce13dc5`  
Scope: server tests, migrations 061–066, authorization consistency, and deletion/revocation/recovery guards. No implementation source was changed.

## Results

### Server tests

The initial `pnpm test` could not start because this worktree had no dependencies (`vitest: command not found`). After `pnpm install --frozen-lockfile` from `app/`, the required command ran against the dedicated disposable Postgres at `127.0.0.1:55443`. The Vitest configuration has `fileParallelism: false`, so the suite ran one file at a time.

| Command | Result | Duration |
| --- | --- | ---: |
| `DATABASE_URL=postgres://context:context@127.0.0.1:55443/context pnpm test` | Vitest: 179 files passed, 2 failed, 1 skipped; 1,639 tests passed, 2 failed, 9 skipped (1,650 total). The shell's `&&` stopped before housekeeper tests. | 1,954.43 s Vitest duration |
| `DATABASE_URL=... pnpm exec vitest run tests/sync-token.test.ts` | 1 file, 9/9 passed. The suite failure was a PostgreSQL deadlock in `resetDb()`'s `TRUNCATE`, not the permission assertion. | 8.69 s |
| `DATABASE_URL=... pnpm exec vitest run tests/vault-channel-e2e.test.ts` | 3/4 passed; the member-removal test again timed out waiting for a `drop` control. This is reproducible, not a load timeout. | 4.81 s |
| Temporary focused channel-removal reproduction (added, run, then deleted) | 1/1 passed: membership removal closes the channel with code 4401, and no further binary document update is sent after close. | 1.15 s |
| `DATABASE_URL=... REVOCATION_TEST_REDIS_URL=redis://127.0.0.1:55444 pnpm exec vitest run tests/guest-revocation.test.ts` | 1 file, 2/2 passed, including the cross-instance socket close over a dedicated Redis. | 2.67 s |
| `node --test housekeeper/*.test.mjs` | 29/29 passed. | 97 ms |

The `sync-token.test.ts` failure was load/contention-related: its deadlock occurred while truncating test data, and the file passed immediately when isolated. The vault-channel test is an outdated assertion: it expects a per-document `drop`, while the current member-removal path closes the entire unauthorized channel. The focused reproduction confirms that updates stop after the close; the test should assert that contract. This remains one reproducible test-suite failure in the reviewed HEAD.

### Migrations

Both paths completed using the dedicated Postgres container.

1. **Empty database:** `DATABASE_URL=postgres://context:context@127.0.0.1:55443/fresh_migrator pnpm run migrate` applied all 63 SQL migration files, including 061–066. `_migrations` contained 63 rows afterward.
2. **Existing database:** applied the files through 059, seeded two users and memberships, one organization, one vault, one folder, one note, and an organization vault grant, then recorded the already-applied prefix in `_migrations`. Running `DATABASE_URL=postgres://context:context@127.0.0.1:55443/upgrade_migrations pnpm run migrate` applied 060–066. It finished with 63 migration records and preserved both members, the vault, and note (2 members, 1 vault, 1 note).

The seed represents existing rows from before the new migrations. Migration 062 created the audit schema and triggers without altering or losing those rows; the seeded org grant produced no orphan-share audit row, as expected.

### Authorization review

No authorization inconsistency or data-loss regression was found in the reviewed paths beyond the stale vault-channel test assertion described above.

- **Resolver and readable listings:** `permissions/resolver.ts` and `permissions/vault-docs.ts` treat guests as scoped only by per-user folder/file grants, including deny/lock handling. `tests/guest-resolver.test.ts` checks resolver, cached resolver, and readable-set agreement. A removed member has no active role and resolves to no membership.
- **HTTP and bulk:** `permissions/guest-http.ts`, the HTTP gates, registry, and bulk routes scope guest listings and writes. Guests cannot create folders, rename/move notes, or use management routes; registration is limited to existing editable shared folders. Tests cover single and bulk operations and unreadable adoption.
- **Hocuspocus and vault-channel:** Hocuspocus rechecks `syncPermission` at authentication; vault-channel recomputes the readable set on ACL changes and closes a removed member with unauthorized code 4401. The focused reproduction verified that no further content frames are sent after closure. Redis-backed `guest-revocation.test.ts` verified the close reaches a second instance.
- **Blobs:** blob reads check `canReadAttachment` against the resolver/path scope; guest deletion is limited to attachments the guest uploaded. `guest-blobs.test.ts` and blob visibility tests passed in the full run.
- **MCP and OAuth:** guests are blocked at the HTTP boundary and excluded from team-only MCP token/OAuth authorization. OAuth tokens require the configured MCP resource and a live generation binding; CIMD metadata fetches pin public DNS results and reject unsafe redirects. Related full-suite files passed.
- **Public links:** link creation/manage operations require authorized team roles and policy checks. Public reads remain capability-based, and disabled external sharing makes existing links unreadable. This is the intended public-link exception to member resolver checks.
- **History, Trash, and AI change ledger:** versions, Trash content/restore, and AI-change reads use live or tombstone-aware document permissions. Guest-facing paths/titles and author metadata are projected/redacted; restore remains blocked outside the guest's editable scope. Related history/trash and guest tests passed.

### Deletion, revocation, recovery, and bulk guards

The inspected paths preserve soft-delete retention and stable document identity, recheck bootstrap access while paging, guard restore with note locking and collision-safe path selection, and keep permanent purge separate from Trash recovery. External bulk revocation commits each individual membership/invitation/link mutation with its progress count and audit record, records partial failures for retry, and serializes guest acceptance/share creation against revocation. The Redis-backed test confirmed cross-instance socket revocation. No guard was found weakened in the reviewed range.

## Finding

| Severity | File:line | Reproduction | Finding |
| --- | --- | --- | --- |
| Low (test maintenance) | `app/apps/server/tests/vault-channel-e2e.test.ts:166` | Reproduced by the full run and by the isolated file; a separate focused test passed. | The test waits for a per-document `drop` after membership removal. The current implementation closes the whole channel with code 4401 (`app/apps/server/src/sync/vault-channel.ts:1231`), which stops further document frames but never emits that `drop`. Update the assertion to verify channel closure and no post-removal content. No access leak was reproduced. |

## Cleanup and commit

- Removed the temporary focused test after it passed; no source or test changes remain.
- Removed only the task-owned `ib-test-verify` Postgres and `ib-test-verify-redis` Redis containers.
- No credentials or `.env` files were added.
- Commit: `docs: record server verification for ce13dc5` (report only).

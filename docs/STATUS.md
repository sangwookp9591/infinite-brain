---
type: status-tracker
product: Infinite Brain
date: 2026-07-13
tags: [infinite-brain, status, roadmap]
---

# Infinite Brain: Build Status

> Live checklist. Update as phases land. Back to index: [[Infinite Brain]].

## Status (2026-10-19)

No hosted server yet. v0.2.0, the first release, was published on 2026-10-19: a notarized universal `.dmg` and a Windows `.exe`, built and signed on this Mac (docs/RELEASE_SIGNING.md). The portfolio site's install buttons read it from `releases/latest`.

| Milestone | State | Report |
|---|---|---|
| M0 Project setup: updater key, icon, `com.infinitebrain.desktop` | ✅ merged | — |
| M1 AI connection wizard + MCP scopes (`notes:read` / `notes:write` / `notes:delete` / `access:manage`), connection list and revoke | ✅ merged | [[reports/IMPL-REPORT-M1]] |
| M2 Multilingual search: Unicode/bigram embedder, zero-score cutoff, `embed_version`, local trigram + filename | ✅ merged | [[reports/IMPL-REPORT-M2]] |
| M3 AI change ledger + undo (revision guard, 409), Activity → AI changes, 90-day retention | ✅ merged | [[reports/IMPL-REPORT-M3]], [[AI-CHANGES]] |
| M4 Invite links without email, onboarding timer | ✅ merged | [[reports/IMPL-REPORT-M4]], [[onboarding-audit]] |
| M5 Galaxy graph (three.js WebGPU → WebGL2 → 2D) | ✅ merged | [[reports/IMPL-REPORT-M5]] |
| Independent review fixes (1 high, 10 medium, some low) | ✅ merged | [[reports/IMPL-REPORT-FIX-V2]] |
| M6 New visual language: zinc/ink tokens, custom accent (`"ink"` or `#rrggbb`, desktop + server), design kit (10 React Bits–adapted components) applied app-wide, ESLint 9, dev WebMCP tools | ✅ merged | [[superpowers/specs/2026-10-15-ui-redesign-color-design]], [[superpowers/plans/2026-10-15-ui-redesign-rollout]] |
| MCP OAuth audience binding (migration 061), secure CIMD clients, consent/exchange/revoke generation guard (review items L1, L3). Unbound legacy OAuth tokens must reconnect | ✅ merged | [[reports/IMPL-REPORT-oauth]] |
| Sparse galaxy on small vaults (radius, star density, camera fit; 2D fallback too) | ✅ merged | [[reports/IMPL-REPORT-GALAXY]] |
| PRD A0 hub authorization design (role × resource matrix, 64-path D6 checklist, Q1–Q15 approved 2026-10-17 except Q10) | ✅ merged | [[superpowers/specs/2026-10-17-hub-a0-authorization-design]], [[reports/IMPL-REPORT-A0]] |
| PRD A1 hub: security fixes P1–P3 (removed creator re-share, non-member sync token, share target validation), audit log, join-code expiry/rotation, hub guests (minimal path projection), external sharing policy, bulk external revocation (migrations 062–066) | ✅ merged | [[reports/IMPL-REPORT-A1-part1]], [[reports/IMPL-REPORT-A1-part2]], [[reports/VERIFY-REPORT-server-ce13dc5]] |
| PRD B0 on-device semantic search measurement (BGE-m3-ko GGUF via llama.cpp, Apple M4 only) | ✅ merged | [[reports/B0-MEASUREMENT]] |
| PRD C0 P2P design (recommends Iroh + own protocol; 14 owner decisions open) | ✅ merged | [[superpowers/specs/2026-10-17-p2p-c0-design]], [[reports/IMPL-REPORT-C0]] |
| M7 Orbit identity redesign: Orbit tokens, bundled Fraunces/Geist/Pretendard, 1.5px icons, icon rail + floating sidebar, editor sheet, dialogs, dashboards, graph tokens; in-house Neuron avatars and vault marks (`@dicebear` removed) | ✅ merged | [[superpowers/specs/2026-10-17-identity-redesign-directions]], [[reports/IMPL-REPORT-redesign-final]] |

| Launch prep: inherited records removed, README rewritten around team use, first-launch motion intro, glass avatars, 40-second intro video (`docs/assets/promo/`) | ✅ merged | — |
| Installers: signed + notarized universal `.dmg` and cross-compiled NSIS `.exe` on one Mac, `latest.json` publishing for in-app updates, password-protected updater key, Actions fallback without Apple secrets | ✅ published as v0.2.0 | [[RELEASE_SIGNING]] |

| Team second brain: PRD v2, A0 authorization design, B0 smart-search spike and first-run mock, kit `ActivityHeatmap` + `ToolCallCard` | ✅ merged (C0 P2P design merged as draft r4, r5 fixes pending) | [[NEXT-TASKS]] |

**Next tasks and handoff (2026-10-16):** [[NEXT-TASKS]]. A1-0 fixes three existing authorization gaps first.

**Verified (2026-10-14/15):**
- Tests: server 1,503, desktop 3,522, Rust 346, `tsc` in both workspaces.
- Local E2E: Korean top-3 search hits went from 2/10 to 10/10. Also checked: read-only connector
  refuses writes, 401 after revoke, AI undo and its 409 conflict, invite acceptance.
- Release macOS build (`pnpm tauri build --bundles app`) launches against a local server.
  Only the welcome screen was observed.

**Not yet verified:** the Windows installer on a real Windows PC, in-app UI flows of the packaged app, real claude.ai / ChatGPT connector
connections (needs a public HTTPS server), usability tests with non-developers, Windows/Linux builds.

**Verified (2026-10-17):** independent server run on `ce13dc5`: 1,639 tests passed, 2 failures
classified (one transient deadlock in `resetDb`, one stale vault-channel assertion, since fixed);
migrations apply on an empty DB and on a seeded 060 DB. Desktop vitest 3,596 and `tsc` in both
workspaces after the redesign. Packaged app, native Windows/WebView2 and real external OAuth clients
remain unverified.

**Open items:**
- Hub guests: full path re-rooting for sync cursors, bootstrap manifest and attachments (Q3), guest seat billing (Q10).
- Membership loss deletes the local team vault folder without a recovery copy (2026-10-09 decision); revisit now that guests and bulk revocation exist.
- Deferred review items L4 (ACL metadata scope), L8/L9 (multi-writer locking, broadcast-then-DB-failure recovery).
- B0 follow-ups: Windows/Linux and packaged-app size measurements, vault-scale quality corpus.

**Decisions pending (owner):** business model, primary target users, whether to rename `.context/` /
the internal `context` DB, the 14 C0 decisions before C1.

**Office collaboration foundation (2026-10-21, local implementation; not a release claim):** LAN
hub TLS identity and native pinned-device-key IPC, `/api/office` identity gating, migration 067,
and pairing capability rejection are implemented. LAN access requires HTTPS/WSS; exact certificate
SHA-256 pin verification is native. The first Ed25519 device key is created on the first office
identity IPC call, in a keychain namespace separate from ordinary keychain IPC. Initial pin approval
requires explicit user approval of a separately delivered invite. Pin replacement/renewal UI is not
implemented. The pairing demo is `node scripts/demo-office-pairing.mjs` from `app/`; its prepared
runtime is built in order with `pnpm run office:prepare`, `pnpm run office:verify`, and
`pnpm run build:desktop:office`. The coordinator owns `office:prepare`; it was not run in this
documentation update. The default desktop build does not include this runtime.

**Update (2026-10-22, local implementation; still not a release claim):** also implemented and verified
on one Mac: opt-in mDNS discovery (`_ib-office._tcp`, private addresses only, candidates are never
trusted), SAS commit-reveal pairing (migrations 068/069, an admin mismatch report counts as a failure and
three cancel the session), IB1 invitation codes, the native join path, the Settings → "사내 협업" tab
(step-by-step join/share flow, invitation creation, admin approval inbox) and Korean strings for the
profile/appearance/notification settings. `node scripts/e2e-office-join.mjs` (from `app/`) runs the whole
path against the bundled hub: real LAN HTTPS, real mDNS, real Rust join code and a test-only OS keychain
entry (19/19; see [[reports/office-join-e2e]]).

Still unimplemented or unverified: syncing a vault through the paired hub (the Yjs provider is not wired to
the pinned relay in a user flow), group ACLs and folder grants, selective sync, checkpoints/restore,
a pin replacement/renewal UI, two real machines, Windows/WebView2, macOS Intel, a Local Network permission
prompt in a signed installed app, and the universal/signing/notarization gate. The release build does not
include the runtime unless built with `build:desktop:office`. The intermittent `sync-token` `resetDb()`
deadlock remains unresolved (seen in 2 of 3 runs, not reproduced in a later independent run). See
[[reports/office-tls-device-validation]] for the earlier validation evidence and its limits.

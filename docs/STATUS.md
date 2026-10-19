---
type: status-tracker
product: Infinite Brain
date: 2026-07-13
tags: [infinite-brain, status, roadmap]
---

# Infinite Brain: Build Status

> Live checklist. Update as phases land. Back to index: [[Infinite Brain]].

## Status (2026-10-19)

No hosted server or published release yet. The first release is 0.2.0, built and signed on this Mac (docs/RELEASE_SIGNING.md).

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
| Installers: signed + notarized universal `.dmg` and cross-compiled NSIS `.exe` on one Mac, `latest.json` publishing for in-app updates, password-protected updater key, Actions fallback without Apple secrets | ✅ merged (first publish pending) | [[RELEASE_SIGNING]] |

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

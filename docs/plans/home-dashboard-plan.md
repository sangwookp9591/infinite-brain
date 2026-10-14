# Baalda Home: pins, a home dashboard, and the visual layer agents can edit

Research reports (full, cited):
- Codebase: `docs/plans/home-dashboard-research-codebase.md`
- Other apps (14 compared): `docs/plans/home-dashboard-research-apps.md`
- Headless agents + sandbox: `docs/plans/home-dashboard-research-agents.md`

## Context

Baalda is a second brain made of `.md` files. It has no visual layer: no way to land on a page that
shows the state of the brain, no pins, no home. Naveed wants (1) pin note/folder to the top of the
sidebar, (2) "set as home" so the app lands on a chosen page at launch, with a Home button in the
sidebar, and (3) that page to be an interactive HTML dashboard that AI agents (Claude Code, Codex,
MCP, scheduled routines) can build and update. Constraints: no second data store (no MD → JSON
export), portable (a file in the vault), shareable through the normal access model, easy to test.

## The one idea

**A dashboard is an `.html` note in the vault.** Nothing else is invented.

- `.html` is already in `NOTE_EXTS` (`formats.ts:159`, `vault.rs:47`): it syncs through the registry
  like a note, carries a `doc_id`, follows the vault's access model, and MCP `update_note` /
  `edit_note` / `append_note` already work on it (docId-based, no extension gate; `mcp/service.ts:637`).
- **Baalda renders. It never generates.** What the dashboard shows, which stats, which layout,
  which words, is decided by the user through their agent (Claude, Codex, MCP, a routine). The
  agent writes the whole page: it reads the brain with the tools it already has (MCP `search_notes`
  / `read_note`, or the files on disk), decides what matters, and writes the HTML. Baalda's job is
  to show that page interactively, keep it synced, and make it easy to ask the agent for changes.
  Baalda does not compute a dashboard from the index.
- **No data duplication.** The page is the *view*. The `.md` files stay the only source of truth;
  there is no exported JSON that must be regenerated. Two ways a page stays current, both the
  user's choice:
  1. **Agent updates (the main one):** the agent rewrites the HTML (a morning summary, a new widget,
     a different layout) via MCP, by editing the file in the vault folder (the watcher syncs it), by
     a scheduled routine, or by the in-app "Update with Claude/Codex" shortcut. The open page reloads.
  2. **Optional live bits:** a page MAY call a small read-only bridge (search, list by folder/tag/
     property, read, backlinks, tags) so a number or a list stays current between agent runs. It is
     a capability the agent can use when the user asks for it, not something Baalda injects. A page
     that never calls it renders exactly as written.
- This is the pattern the research found nobody shipping: Trilium's render notes (HTML note queries
  the live tree, but unsandboxed) + Claude Artifacts' sandbox + MCP Apps' postMessage bridge + Obsidian
  Bases' small query vocabulary, with the file itself being the shareable, agent-editable unit.

## What exists today (reuse)

- `HtmlView.tsx:96`: `.html` opens in a `srcdoc` iframe with `sandbox=""` (scripts OFF) plus a Source
  textarea saving through `ipc.writeNote`; reloads on `onFileChanged` (`:41`). `FilePreview.tsx:146` picks it.
- CSP (`tauri.conf.json:28`, pinned by `src/__tests__/csp.test.ts`): `script-src 'self'`, `frame-src
  'self'` + asset origins. **Blocker:** srcdoc/blob iframes inherit the parent CSP, so an interactive
  dashboard works in `tauri dev` and silently breaks in packaged builds. Must be fixed first.
- Read primitives in `ipc.ts`: `searchNotes :578`, `listTree :399`, `readNote :404`, `getNoteMeta :596`
  (frontmatter JSON), `getBacklinks :587`, `getGraphEdges :591`, `listTags :1156`,
  `listPropertyKeys/Values :1141`, `vaultStats :1030`. Missing: notes by tag / by property / generic
  filtered list (new Rust commands over `index.rs:339` tables `notes`, `tags`, `note_tags`, `links`).
- Launch (`App.tsx:1157-1205`): reopens the last vault, refreshes tree + titles, opens NO note; only
  the welcome flows open one (`store.ts:2358`, `:2378`). Clean hook for a home redirect, via
  `openNoteByPath` (`store.ts:2386`).
- Sidebar: `FileTree.tsx` (react-arborist `<Tree>` at `:1894`, sort at `:510-522`, row menu
  `:1940-2060`); `App.tsx:1592` lays out `SidebarHeader` → `FileTree` → footer; search button in
  `SidebarToggle` (`App.tsx:1580`). No pin/star/favorite concept anywhere.
- Prefs layers: device `localStorage` `context.*`; per-vault `.context/config.json`
  (`ipc.getVaultConfig/setVaultConfig :1117`); team-wide `vault_appearance` (`appearance/schema.ts`
  refuses unknown keys; fan-out `appearance-changed`, `vault-channel.ts:1143` → `vaultSyncEngine.ts:915`).
  No per-user server prefs exist.
- Hints: `WhatsNewModal` (`App.tsx:855`), one-off keys like `context.accessBoard.dragHintShown`,
  `noticeSlot.ts:23` priority list.
- Process spawning: none (no shell plugin, no `std::process::Command`).

## Plan (five implementation stages; stages 1–4 are the MVP)

Order: PR 1 → PR 2 → PR 3 → PR 4. PR 2 does not depend on PR 1 (any note can be home), so it can be
built in parallel; PR 3's templates need PR 1's bridge; PR 4 needs PR 3's dashboard header.

### PR 1 — Interactive HTML runtime (the enabler)

**Rust: `baalda-view` URI scheme.** `register_asynchronous_uri_scheme_protocol("baalda-view")` in
`lib.rs`, serving vault files (`resolve_in_vault`, refuse `.context/`, refuse non-`ALLOWED_EXTS`) with
its OWN response headers: `Content-Security-Policy: default-src 'none'; script-src 'self'
'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src
'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src
'self' data: blob:; connect-src 'none'; frame-src 'none'`. Relative `./attachments/x.png` just works.
URL forms: `baalda-view://localhost/<rel>` (macOS/Linux), `http://baalda-view.localhost/<rel>`
(Windows). Also serves `/__baalda/sdk.js` (the client library, bundled in the app).

**Parent CSP:** add the scheme (+ Windows variant) to `frame-src` only; `script-src` stays `'self'`.
Update `csp.test.ts` to pin the new value.

**Iframe (`HtmlView.tsx`):** `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`,
never `allow-same-origin`, never `allow-top-navigation`. Opaque origin ⇒ no Tauri IPC reachable from
the page. Authenticate messages by `event.source === iframe.contentWindow` (`event.origin` is `"null"`).
Keep the existing Source tab. Keep "scripts run" visible as a small header badge so a user knows it's
live. Reload on file change but restore scroll + state through the bridge (today's reload resets both).

**Bridge (`src/lib/dashboard/bridge.ts`, pure TS, vitest-able):** JSON-RPC-ish request/response over
postMessage, read-only except two navigations. Methods, kept to the Bases-sized vocabulary:
`vault.info` (name, user, theme tokens, platform) · `notes.search(q, limit)` · `notes.list({folder,
tag, property:{key,value}, modifiedSince, sort, limit})` · `notes.read(docId|path)` · `notes.meta` ·
`notes.backlinks` · `graph.edges` · `tags.list` · `properties.keys/values` · `vault.stats` ·
`state.get/set(key)` (host-backed, because `localStorage` throws in an opaque origin; stored in
`note_ui_state` per doc, device-local) · `app.open(path|docId)` · `app.openExternal(url)` (opener
plugin) · `app.keydown` relay for the app's own shortcuts. Backed by existing `ipc.*` plus two new Rust
commands (`list_notes_by_tag`, `list_notes_by_property`) and one generic `query_notes` filter command.

**`sdk.js`:** tiny promise wrapper (`baalda.notes.search(...)`), auto-applies theme CSS variables
(`--bg`, `--fg`, accent tokens from `tokens.css`) and `data-theme`. Templates include it with
`<script src="/__baalda/sdk.js">`. A hand-written dashboard that does not include it still renders;
it just has no data.

**AI-native touch:** every template starts with an HTML comment block "How to edit this dashboard"
listing the bridge API, so any agent that opens the file (Claude Code, Codex, MCP `read_note`)
learns the API from the file itself. The same reference ships as `docs/DASHBOARDS.md`.

Tests: bridge handler unit tests (method dispatch, unknown method, source check); Rust tests for the
scheme's path safety (`..`, `.context`, absolute); `csp.test.ts` update. **Manual test must be a
packaged build** (`pnpm run build:desktop`): dev has no CSP, so dev proves nothing here.

### PR 2 — Pins and Home

**Pins — personal first, plus vault-wide by owner/admin (decided).** `src/lib/pins.ts` (pure) merges
two lists of `{kind: 'note', docId} | {kind: 'folder', path}`:
- **Personal pins**: device-local `localStorage` `context.pins:<vault>` (same layer as sort order and
  colours). Anyone. Row menu "Pin" / "Unpin".
- **Vault pins**: `pinnedItems` in `vault_appearance` (`appearance/schema.ts` + CHECK list), set by
  owner/admin via "Pin for everyone" / "Unpin for everyone"; fans out through `appearance-changed`
  like colours. A member sees them with a small "everyone" marker and cannot remove them (tooltip
  "Pinned for everyone by a vault admin"); they can add personal pins alongside.
- One **Pinned** section between `SidebarHeader` and `FileTree` (`App.tsx:1592`): vault pins first,
  then personal, de-duplicated by id. Rows reuse the tree row renderer so colours/presence/padlocks
  match; pin icon on hover; notes follow renames by `doc_id`, folders by path through the existing
  rename/move hooks; an item that disappears is dropped silently. Same two-tier shape as Home.

**Home.** Resolution: personal override > vault home > none.
- Vault home: `homeDocId` added to `appearance/schema.ts` (+ its CHECK list), set by owner/admin via
  "Set as vault home"; reaches every device through `appearance-changed`.
- Personal override: `localStorage` `context.home:<vault>` via "Set as my home" (anyone).
- Launch hook: after `refreshTitles` in the auto-reopen (`App.tsx:1157-1205`) and in the vault-switch
  flows, BEFORE `openWelcomeIfPresent`; open with `openNoteByPath` resolved from the doc-id map.
- **Home button** beside the search button in `SidebarToggle` (`App.tsx:1580`), shortcut
  `Cmd/Ctrl+Shift+H`; with no home set it opens the PR 3 empty state. "Set as home" also appears in
  `HtmlView`'s header and the row menu. Any note can be home, not only `.html`.

### PR 3 — Templates, "New dashboard", onboarding, agent paths

- **Templates are starting points for the agent, not pages Baalda fills in.** Each bundled template
  (`src/dashboards/templates/`) is an example page plus a prompt: *Daily home*, *Project tracker*,
  *Reading list*, *Team pulse*, *CRM-lite*. The user picks one and the real content is written by
  their agent from their notes ("Build me a project tracker from my #project notes, grouped by
  status"). The example pages show the look, the self-documenting comment header, and where live
  bridge calls are optional. A user with their own HTML skips templates entirely.
- **New dashboard**: Home empty state + row menu "New dashboard…" → pick a template or "Blank" →
  writes `Home.html` (or chosen name) create-only via existing create path → offers "Set as home"
  and "Ask your agent to fill it in" (copy prompt, or run the installed CLI from PR 4).
- **Many dashboards, one Home (decided).** A dashboard is any `.html` note (later also a linked
  `.url`, see PR 5), so there is no "dashboard" entity to store. The **Home button gets a dropdown**:
  the home at the top, then every dashboard in the vault (query the index for `.html` notes,
  `index.rs` `notes` by extension, personal pins among them first), then "New dashboard…" and
  "Set as home". Home stays exactly one per person (override) and one per vault (default); the
  dropdown is where the others live. Plain click on the button opens Home; a vault with no home
  opens the picker. Nothing is written anywhere: moving a dashboard into any folder is just moving
  a file, and sharing one is the normal access model.
- **Discovery**: one-time dot badge on the Home button (`context.home.hintShown`), a `WhatsNewModal`
  entry, and the empty state as the real introduction. No file is written into anyone's vault
  without a click (vault purity).
- **Agent paths, documented in the empty state and `docs/DASHBOARDS.md`:**
  1. MCP (works today): fix `create_note`/`move_note` descriptions that say ".md"; mention `.html`
     dashboards and the bridge API in tool descriptions so remote agents write valid pages.
  2. Scheduled: a Claude Code cloud routine (`/schedule`, min 1 h, runs with the laptop closed,
     connectors included) with the Baalda connector (MCP OAuth is already live) = "every morning,
     rewrite my Home". Claude Desktop local scheduled tasks and Codex automations also work but need
     the machine awake.
  3. On disk: Claude Code / Codex run in the vault folder edit `Home.html`; the watcher →
     `handleLocalFileChanged` → uploader syncs it; `HtmlView` reloads.
  4. **"Ask AI to change this"** button in `HtmlView`: copies a ready prompt (API reference + current
     file path) to paste into any agent. Zero-risk MVP stand-in for the CLI runner.

### PR 4 (in the MVP, decided) — Run the user's installed CLI from Baalda

- Detect: `fix_path_env::fix()` at startup (GUI apps don't inherit Homebrew/nvm/`~/.local/bin` PATH),
  then `claude --version` / `codex --version` with known-path fallbacks; login check `claude auth
  status` / `codex login status`.
- Spawn: a typed Rust `run_agent` command (tokio::process, `kill_on_drop`, cwd = vault), streaming
  NDJSON to the UI over `tauri::ipc::Channel`. Avoid `tauri-plugin-shell` (free-text prompt arg needs a
  catch-all scope and widens the webview's reach).
- Commands: `claude -p "<prompt>" --output-format stream-json --verbose --permission-mode acceptEdits
  --allowedTools "Read,Edit,Write,Glob,Grep" --permission-prompts none --max-budget-usd 1` (never
  `--bare`: it drops the subscription login; an `ANTHROPIC_API_KEY` in env overrides it) and
  `codex exec "<prompt>" -C <vault> --skip-git-repo-check --sandbox workspace-write --json`.
- UI: "Update with Claude / Codex" on the dashboard → prompt → streaming log → watcher does the rest.
  Naming/policy caveat: this runs the user's own installed CLI on their own login; do not brand it
  "Claude Code" or embed the Agent SDK with subscription auth (Anthropic's SDK terms). Verify terms
  before shipping.
- Shows only when a CLI is detected; otherwise the "Ask AI to change this" copy-prompt button from
  PR 3 remains the path. Detection result is cached per launch and shown in Account Settings → About.
- A run is scoped to the vault folder (cwd + `--add-dir`), never the home directory; the streaming
  log is kept in memory only; cancel = SIGINT (ends the turn cleanly; SIGTERM exits 143).

### PR 5 (first thing after the MVP) — Import a link as a dashboard (Claude Artifacts, Codex sites, any URL)

- **Representation: a `.url` file in the vault** (the real Windows Internet Shortcut format, two lines:
  `[InternetShortcut]` / `URL=https://…`; macOS `.webloc` read too). Portable, Finder-openable,
  diff-able, and an agent can create one with a single write. Add `url`/`webloc` to the formats
  contract as a NOTE_EXT (text, synced like a note, MCP-editable; `formats.ts`, `vault.rs`,
  `registry.ts`, `inbound.ts`, `formatsLockstep.test.ts`). "Add dashboard from link…" in the Home
  dropdown writes it; it appears in the dropdown and can be home or pinned like any dashboard.
  Alternative considered and rejected: a `links` list in `vault_appearance` (not a file, not portable).
- **Rendering: a remote iframe, no sandbox attribute needed for isolation** (cross-origin already
  isolates; the bridge is not offered to remote pages). Parent CSP `frame-src` gains an allowlist
  (`https://claude.ai`, `https://*.claude.site`, `https://chatgpt.com`, `https://*.openai.com`, plus
  whatever Codex publishes sites on) and a Settings toggle "Allow any https link" for self-hosted or
  Vercel-style URLs. Link clicks inside stay inside; a "Open in browser" button is always present.
- **Feasibility gate (do this first, one hour):** check the response headers of a public Claude
  artifact URL and a Codex site for `X-Frame-Options` / `frame-ancestors`. If either refuses framing,
  that source falls back to "Open in browser" in the MVP of PR 5, and the robust path becomes a
  **Tauri child webview** (`unstable` feature, a native webview positioned over the content pane,
  not subject to frame-ancestors) in a follow-up; it costs resize/z-order/theme handling, which is
  why it is not the default.

### Later (not MVP)
- `GET /p/:token` renders `.html` escaped today; add a sandboxed HTML branch so a public link shows
  the dashboard (its bridge calls would then no-op or hit the public read API).
- Personal pins/home synced across devices (needs a per-user server prefs table; none exists).

## Decisions (confirmed 2026-10-11)

1. Pins: personal (device-local) first; owner/admin can additionally pin for the whole vault.
2. Home: vault default set by owner/admin + personal override.
3. MVP = PR 1–4, including the installed-CLI runner.
4. Introduction: Home button + empty state + one-time dot; nothing written into a vault without a click.
5. Many dashboards, one Home: in the MVP via the Home dropdown (free, no new entity). Linked
   dashboards (Claude Artifacts, Codex sites, URLs) as `.url` files: PR 5, right after the MVP.

### Implementation decisions confirmed during this session

- Implement all five stages directly on `staging`, with local commits and no PRs.
  Include these plan/research documents; leave unrelated `access-dryrun` work untouched.
- Ship the installed Codex runner first. Claude uses Copy agent prompt; do not
  invoke Claude subscription authentication from Baalda.
- Use a strict named Codex permission profile rather than the historical command
  examples above. Deny private vault metadata and outside-vault reads/writes,
  disable agent-tool network access, and fail closed on incompatible CLI versions.
- Protocol views use an epoch and a per-mount lease. Local assets are limited to
  presentation formats; note content is read through the authorized bridge.
- Shared appearance updates use PATCH; pin toggles and folder-pin rewrites are
  atomic to preserve simultaneous Home, theme and pin changes.
- Synced bridge reads require a fresh server-readable list. Local-only reads work
  offline; saved dashboard HTML renders without the bridge.
- HTTPS iframe policy is static in the packaged CSP and gated in the host by
  the known-domain allowlist/device preference. Known blocked sources use the
  browser fallback. Native child webviews remain a future follow-up.

The original PR labels below describe implementation stages, not a request to
create PRs. Current behavior and the SDK reference are in `docs/DASHBOARDS.md`.

## Rough effort (one lead + subagents, each PR tested locally before merge)

| PR | Scope | Estimate |
|---|---|---|
| 1 | URI scheme, CSP, sandboxed iframe, bridge, sdk.js, 3 Rust query commands | ~5 days |
| 2 | Pins (personal + vault), Home (vault + override), button, launch hook | ~3 days |
| 3 | 5 templates, dropdown/picker, onboarding, MCP descriptions, docs | ~4 days |
| 4 | CLI detection + Rust runner + streaming UI | ~4 days |
| 5 | `.url` dashboards + remote iframe allowlist (+ feasibility check) | ~3 days |

## Verification

- `pnpm test` in `app/apps/desktop` (bridge unit tests, `csp.test.ts`, `formatsLockstep`), `cargo test`
  in `src-tauri` (scheme path safety, new query commands).
- Packaged build on macOS: open a template dashboard; buttons/scroll/scripts work; a `fetch()` to any
  host is refused; `./attachments/` images load; `Cmd+K` typed inside the frame still opens search.
- Two devices: owner sets vault home → second device lands on it at next launch; personal override wins.
- MCP: `update_note` on `Home.html` from Claude → open page reloads with scroll kept.
- On disk: edit `Home.html` with Claude Code in the vault folder → synced + reloaded.
- Pin/unpin note and folder; rename pinned note (in-app and Finder) → pin follows; owner pins for
  everyone → a member's sidebar shows it with the marker and cannot unpin it.
- CLI runner: with `claude` installed via `~/.local/bin` and `codex` via nvm (this Mac), both are
  detected from the packaged app; "Update with Claude" on `Home.html` streams output and the page
  reloads; with neither installed the button is absent and the copy-prompt button remains.


### Implementation verification — 2026-10-11

- Desktop TypeScript: full suite passed, 306 files / 3,373 tests; 2 files /
  12 tests intentionally skipped. Run with
  `NODE_OPTIONS=--no-experimental-webstorage pnpm test` on this Node version.
- Rust: full `cargo test --quiet` passed, 335 tests; 2 ignored.
- Server: 61 database regression tests passed against a separate disposable
  PostgreSQL instance, covering appearance permissions/concurrent updates,
  folder pin moves and registry behavior. The development database was untouched.
  Focused mocked route/transaction tests also passed.
- Desktop and server TypeScript checks passed. Windows frontend build passed.
- Packaged macOS app: inline scripts, SDK/theme, authorized note reads, local
  images, blocked fetch, Tauri isolation, buttons, keyboard search relay,
  watcher reload/scroll state, template creation and startup Home were checked
  with a synthetic local-only vault and an isolated application profile.
  An external HTML rename retained its open view, personal pin, Home and saved
  SDK state, including after quitting and reopening the final bundle.
- Both macOS and Windows simulator layouts were inspected at normal and narrow
  widths, including the Home chooser and dashboard creation dialog.
- Codex sandbox probes verified vault writes and denied private metadata/outside
  reads. Runner cancellation/process/output bounds have regression coverage;
  no model inference or paid run was triggered during verification.
- Native Windows execution and a two-device end-to-end shared Home/MCP session
  were not available. Windows-specific identity/process helpers were typechecked;
  a full Windows Rust cross-build lacked the MinGW compiler. Server regression
  tests cover shared appearance concurrency and permission contracts.
- An isolated macOS app bundle built successfully with updater artifacts disabled
  in a temporary test configuration. The ordinary installer build produced the
  app/DMG but could not finish updater signing without the release signing key.
  No release credentials or tracked release configuration were changed.

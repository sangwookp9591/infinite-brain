# Baalda exploration: pins, home dashboard, AI-updated HTML

(Read-only report. Plan mode blocked writing to the scratchpad path, so it lives here.)
Paths relative to `app/apps/desktop` unless prefixed `server/`.

## 1. HTML files as notes

- `src/lib/formats.ts:159-172` html/htm entry: `viewer: "html"`, `syncAs: "note"`, `cmLang: htmlLang`.
  Comment: "Pages keep `HtmlView` (plain read/write, no CRDT editor) even though they already sync as notes".
  `NOTE_EXTS` at `formats.ts:841` includes html. Mirrors: `src-tauri/src/vault.rs:27` (ALLOWED_EXTS), `:47` (NOTE_EXTS);
  `src/lib/sync/registry.ts:666`, `src/lib/sync/inbound.ts:307` (literal copies, pinned by formatsLockstep test).
- `src/lib/notePath.ts:47` `isEditorNote` = md|markdown|mdx|txt ONLY. html/canvas sync as notes but never ride the bridge.
  `store.ts:2431` open-time `registerNote` is skipped for html (flattenTree registers it instead).
- Display: `src/components/FilePreview.tsx:146` `if (viewer === "html") return <HtmlView path={path} />`.
- `src/components/HtmlView.tsx` (120 lines): Preview/Source toggle. Preview = `<iframe sandbox="" srcDoc={content}>` (`:96-101`), so NO scripts,
  no forms, no same-origin. Source = plain `<textarea>` + Save (Cmd+S) via `ipc.writeNote` (`:55`). Reads via `ipc.readNote`;
  re-reads on `ipc.onFileChanged` (`kind === "modified" && !unchanged && !dirty`, `:41-44`). Docstring at `:4-9` is STALE
  ("HTML files are local-only — they don't join the CRDT sync") — they do sync as notes.
- Other iframes: `FilePreview.tsx:69` PDF pane (`src={convertFileSrc(abs)}`), `lib/editor/livePreview.ts:325` PdfEmbedWidget.
  DocxView deliberately NOT an iframe (`components/viewers/DocxView.tsx:5`).
- Inline HTML sanitizer: `src/lib/editor/sanitizeHtml.ts` `renderEmbeddedHtml` — drops SCRIPT/STYLE/LINK/IFRAME/OBJECT/EMBED/META/BASE
  (`BLOCKED_HTML_TAGS`), strips `on*`, strips `style` attrs, strips dangerous URLs (`urlSafety.ts isDangerousUrl`), rewires anchors to open externally.
  Used for raw HTML blocks in markdown and docx output. Not used by HtmlView.

## 2. CSP and webview

- `src-tauri/tauri.conf.json:28`:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: http://asset.localhost https://asset.localhost data: blob: https:;
   media-src ... blob:; frame-src 'self' asset: http://asset.localhost https://asset.localhost; connect-src 'self' ipc: http://ipc.localhost https: wss: http://localhost:* ws://localhost:* ...;
   font-src 'self' data:; object-src 'none'; base-uri 'self'`
- `src/__tests__/csp.test.ts` pins: default-src == ['self']; frame-src contains 'self' + 3 asset origins; media/img contain asset origins;
  "must NEVER widen": object-src ['none'], script-src ['self'] (exact equality), base-uri ['self']. CSP is injected only in PACKAGED builds — dev has none,
  so anything that works in `tauri dev` can break after release.
- Verdict:
  - `<iframe sandbox="allow-scripts" srcdoc>`: srcdoc docs INHERIT the parent CSP, so inline `<script>` is blocked (script-src 'self', no 'unsafe-inline').
    Works in dev, breaks packaged. Not viable without widening script-src, which the test forbids.
  - `blob:` iframe: frame-src lacks `blob:` AND blob docs inherit the creator CSP. Blocked.
  - Asset-protocol iframe (`convertFileSrc(<vault>/x.html)`) is already allowed by frame-src, and `assetProtocol.enable: true` with scope granted
    per opened vault (`src-tauri/src/commands.rs:373 asset_protocol_scope().allow_directory(&path, true)`). A navigated document gets its policy from
    its own response, not the parent, so `sandbox="allow-scripts"` (no allow-same-origin) would execute inline scripts there. Risk: no CSP on that
    response means the page can fetch any https host (exfiltration), and relative URLs can reach other vault files. Unverified whether Tauri adds CORS/CSP headers to asset responses.
  - Most controlled option: a Rust custom URI scheme (`register_asynchronous_uri_scheme_protocol`, none exists today) serving the note body with its OWN
    strict CSP header (e.g. `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src asset: data:; connect-src 'none'`), plus adding that scheme to
    frame-src (test update: add an assertion for the new scheme, keep script-src/object-src untouched). Data via `postMessage` to the parent.
- Capabilities: `src-tauri/capabilities/default.json` = core, opener (open-url scoped, open-path `$HOME/**`), dialog, fs, updater, process, log, deep-link;
  `windows.json` = window min/max/close. NO shell plugin. Cargo.toml deps: opener, dialog, fs, process, log, deep-link, updater, single-instance — no
  `tauri-plugin-shell`. No `std::process::Command` anywhere in `src-tauri/src` (only `std::process::id()` in notefile.rs:33). No sidecar. JS: no `Command.create`.
  `process:default` is tauri-plugin-process (exit/relaunch), not spawning.

## 3. Sidebar / tree / open-note model

- `src/components/FileTree.tsx`: react-arborist (`:20`, `<Tree<TreeNode>` at `:1894`). Rows from a component type (`:2226` note re: remount).
- Sorting: `:510-522` `applyOrder(sortTree(level, treeSort, folderSorts), "", itemOrder)` — two layers: sort then manual order. `orderPinned`/`pinnedMtimes`
  (`:440-441`) freeze mtime ordering while pointer is in tree (NOT a user "pin" feature). Prefs: `context.treeSort`, `context.folderSort:`, `context.itemOrder:` (localStorage).
  A pinned section would be a third layer or a separate list rendered above `<Tree>`.
- Row context menu: `onRowMenu` `:1622`; menu JSX `:1940-2060`: New note, New folder, Import files…, Import folder…, Open vault folder (root only),
  Export…, Reveal, Rename, Sort by ›, Reset manual order, Share… (`SHOW_SHARE_ITEM`), Unlock (legacy locks), colour, Delete. Rows `onContextMenu` at `:2659`.
  There is also `RowActionsMenu.tsx` (⋯ button).
- Folder colours: `store.ts:529 itemColors`, `setItemColor :2097` → localStorage `context.itemColors:<vault>` (`lib/appearance.ts:134`) AND
  `syncManager.setItemColor` (`lib/sync/docSession.ts:1455`) → server `color` column on notes/folders (`api.ts:276` "Palette id, shared by the whole team").
  So item colours are TEAM-shared, path-keyed locally, id-keyed on server.
- Chrome row: `App.tsx:1580` `<SidebarToggle>` with search + (Windows only) graph button (`SidebarToggle.tsx:64`); macOS/Linux GraphButton in
  `main-header .header-actions` (`App.tsx:1651`). Header: `<TabBar/>`, SyncIndicator, TalkButton, ShareNoteButton, GraphButton, panel button.
  A Home button fits beside search in SidebarToggle (all platforms) or in header-actions.
- Sidebar layout `App.tsx:1592-1620`: `<SidebarHeader/>` (vault name + switcher) → `.sidebar-tree-wrap > <FileTree/>` → footer (BackendBehindNotice, AccountMenu).
  Pinned section slots between SidebarHeader and FileTree (or at top inside FileTree's scroll area).
- Open-note state: `store.ts:220 openNote {path,id,title}`, `openTabs: string[]` (`:226`, "Session-only, vault-scoped" — NOT persisted),
  `virtualTabs`, `activeVirtualTab`. `openNoteByPath` `:2386` (sets `openingNotePath`, registers editor notes, pushes tab `:2469`).
  Close-tab neighbour logic `:2821-2875`. No MRU list in store (MRU tab card lives in TabBar per memory; not verified).
- LAUNCH: `App.tsx:1157-1205` auto-reopen: `getLastVault` → `openVault` → `setVault` → `refreshTree` → `refreshTitles`. NO note is opened at launch;
  tabs are not restored. Only welcome flows open a note: `store.ts:2358 seedLocalVaultIfEmpty` (new local vault) and `:2378 openWelcomeIfPresent`
  (after sign-in, only if `!openNote`, opens `WELCOME_NOTE_PATH`); also `:5095`. `ipc.onVaultOpened` (`App.tsx:1404`) only calls `setVault`.
  Home hook: right after `refreshTitles` in the auto-reopen (needs titles/tree to resolve the home path), in `setVault`/vault-switch flows, and in
  `openWelcomeIfPresent` (home should win over Welcome). Must respect the openGate/sync prime for synced vaults (`openNoteByPath` already handles it).

## 4. Preference storage layers

- localStorage (device-local), keys: context.treeSort, context.folderSort:<v>, context.itemOrder:<v>, context.itemColors:<v>,
  context.itemColors.adopted:<v>, context.automaticItemColors:<user>, context.sidebarHidden, context.sidebarWidth, context.editorFontSize,
  context.editorMeasure, context.readableLineLength, context.lineNumbers, context.propertiesMode, context.appearanceOverrides.v1,
  context.graph.settings.v5, context.memberAccess.view, context.accountVaults.view, context.accessBoard.dragHintShown, context.invites.seen.v1,
  context.lastVault, context.knownVaults, context.knownMemberships, context.orgVaults, context.teamAccess:<server>:<org>, context.serverChoice,
  context.rememberEmail/rememberedEmail/rememberPassword, context.justUpdated, context.activityStatus, context.mentionSound, context.vaultIcon:*,
  context.healthIgnored:<vaultPath>. Helpers in `src/lib/prefs.ts`, `lib/ordering.ts`, `lib/appearance.ts`.
- `.context/config.json` (per vault, travels with folder): `ipc.getVaultConfig/setVaultConfig` (`ipc.ts:1117-1120`), raw JSON owned by TS sync layer
  (server vault id, doc-id map, fileBases, ackedSv, …).
- `.context/types.json`: `ipc.getVaultTypes/setVaultTypes` (`ipc.ts:1128-1131`), property type registry.
- index.sqlite `note_ui_state` (per-note, device-local, keyed by doc_id): `ipc.getNoteUiState/setNoteUiState` (`ipc.ts:1165-1176`).
- Server per-org appearance: `server/src/appearance/schema.ts` (theme, autoColors, contentWidth, textSize, lineNumbers, properties; unknown keys
  REFUSED). Routes `server/src/http/routes/appearance.ts:33 GET`, `:47 PUT` (owner/admin). Table `vault_appearance` (migration 053). Fan-out:
  `server/src/sync/vault-channel.ts:1143-1145` sends `{t:"appearance-changed",...}`; desktop `lib/sync/vaultSyncEngine.ts:915` handles it,
  `store.ts:578/783`. Client wrappers `api.ts:3255-3272`.
- Server team-shared per-item: `color` on notes/folders (above).
- Per-user server prefs: NONE found (no user_prefs/user_settings table or route).
- Pin/star/favorite/bookmark: NONE exists in desktop or server (only unrelated "pinned" words: FileTree mtime freezing, SeatUsageBreakdown, vault list).
- Recommendation:
  (a) personal pins → localStorage keyed by vault + doc_id (like itemOrder/itemColors), or `note_ui_state`-style index table; doc_id not path so renames survive.
      If pins must follow the user across devices, a new per-user server table is needed (nothing exists).
  (b) vault-wide team home → extend `vault_appearance` schema with `homeDocId?: string` (must add to CHECKS or PUT refuses it) and reuse the
      `appearance-changed` frame, or a sibling route on the same pattern. Owner/admin only, matches appearance.
  (c) personal home override → localStorage `context.home:<vault>` = doc_id (device), falling back to team home.

## 5. Data access for a dashboard bridge

- Rust IPC (`src/lib/ipc.ts`): `searchNotes(query)` :578 (FTS5 snippets), `listTree` :399, `listChildren` :402, `readNote(path)` :404,
  `getNoteMeta(path)` :596 (id, path, title, mtime, sha256, frontmatter), `listNoteTitles` :600, `getBacklinks(noteId)` :587, `getGraphEdges` :591,
  `getGraphEdgesFor` :594, `resolveWikilink(name)` :598, `listTags` :1156 (name+count), `listPropertyKeys` :1141, `listPropertyValues(key)` :1145,
  `getFileText(path)` :582, `listFileRows` :586, `vaultStats` :1030, `fileStat` :900. Rust impls in `src-tauri/src/commands.rs:1516-2151`.
- Missing primitives: no "notes with tag X", no "notes where property = value", no generic SQL/query command. Would need new Rust commands.
- index.rs schema (`src-tauri/src/index.rs:339-500`): `notes(id, path UNIQUE, title, mtime, sha256, frontmatter TEXT JSON)`, `notes_fts(title, body)`,
  `tags(id,name)`, `note_tags(note_id, tag_id)`, `links(src_note_id, dst_note_id, dst_path_raw, link_text, position)`, `folders(id,parent_id,name,path)`,
  `files`, `files_fts`, `file_text`, CRDT tables, `note_ui_state`. Frontmatter stored as a JSON blob per note (queryable with json_extract), not normalized.
  Note: html notes are index rows too (NOTE_EXTS), so a dashboard has a doc_id.
- Server HTTP: `server/src/http/routes/graph.ts:43 GET /vaults/:vaultId/graph`, `:108 GET /vaults/:vaultId/search` (semantic), `GET /api/notes?vaultId`
  (`api.ts:2622 listNotes`). Works only when synced and signed in; the local IPC set works offline.
- Opening a note from the dashboard: `useStore.getState().openNoteByPath(path)`.

## 6. MCP and AI update paths

- `server/src/mcp/tools.ts`: create_note/move_note DESCRIPTIONS say "ending in .md" (`:441,:446,:643`) but `mcp/service.ts:637 createNote` has no
  extension check (only `resolveParentFolder` + permission). update_note/edit_note/append_note operate on docId with no extension gate, so they work
  on .html notes (append says "markdown" in copy only). Descriptions would need updating to advertise html.
- External on-disk edit (Claude Code writing the .html): watcher `files-changed` → `App.tsx` routes to `syncManager.handleLocalFilesChanged` (`App.tsx:~1398`)
  → html is never a resident bridge note, so it goes the closed-note path (ContentUploader `force` + ingestFromFile). HtmlView re-reads on
  `onFileChanged` modified (`HtmlView.tsx:41`). An MCP/teammate edit arrives as CRDT → written to disk by the sync layer → watcher → HtmlView reload.
  A re-render on change therefore already exists, but it resets the iframe (state/scroll lost); a dashboard view should diff or postMessage a reload.
- HtmlView Save writes the file directly (`ipc.writeNote`), not a CRDT op; concurrent edits merge only via the ingest diff, not live.
- Housekeeper/Assistant UI: `components/HousekeeperPanel.tsx`, `AssistantLocalRepair.tsx`, `AssistantProviderSettings.tsx` — server-hosted module
  (`server/src/http/routes/housekeeper.ts`), no local process spawn.
- Local CLI spawning: none anywhere. Detecting/running `claude`/`codex` headless needs either `tauri-plugin-shell` (+ capability with scoped
  `shell:allow-spawn` and explicit allowed programs) or a Rust command using `std::process::Command` with PATH lookup (GUI apps on macOS get a
  minimal PATH; need login-shell PATH resolution, e.g. `zsh -lc 'command -v claude'`).

## 7. Onboarding / hints

- `WhatsNewModal` `App.tsx:855` (post-update notes from `justUpdatedTo` stash, `context.justUpdated`).
- One-time hint pattern: `MemberAccessBoard.tsx:53 DRAG_HINT_KEY = "context.accessBoard.dragHintShown"`; `context.invites.seen.v1` (`lib/inviteSeen.ts`).
  No general `seenHints` registry.
- Notice slot `src/lib/noticeSlot.ts:23 NOTICE_PRIORITY`: held-delete, reconcile, note-removed, vault-unsynced, membership-lost, root-missing,
  root-restored, account-lapsed, closed-app-changes, not-syncing, sync-paused, note-limit, create-refusal, removed-on-disk, attachment-local-only.
  A "Meet your dashboard" notice would go last (lowest priority) and fade after NOTICE_FADE_MS.

## 8. Public links

- `server/src/http/routes/public-links.ts`: mint is per docId, no extension gate seen (mint/inspect/revoke on `/api/notes/:docId/public-link`), so an .html
  note can be minted. `GET /p/:token` renders through `server/src/render/note-html.ts` — escape-first markdown subset; raw HTML becomes visible literal text.
  An HTML dashboard would show as escaped source. Sharing a live dashboard publicly needs a separate render path (sandboxed, strict CSP, no vault data bridge).

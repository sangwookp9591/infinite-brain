# Research: pins, home/dashboard, interactive HTML views in note apps (for Baalda)

Date: 2026-10-11. Written here because plan mode blocked the requested scratchpad path
(`.../scratchpad/research-apps.md`). Items marked **(unverified)** come from prior knowledge, not a page fetched in this session.

## 1. Comparison table

| App | Home mechanism | Pin mechanism | Dashboard = file in vault? | Data access | Interactive? | Where the setting lives |
|---|---|---|---|---|---|---|
| Obsidian + Homepage plugin | Opens a chosen note, canvas, base or workspace at startup; random/daily note options; tab handling (keep/replace/close); view mode; can run commands on open [1] | Core Bookmarks: files, folders, graphs, searches, headings, blocks, links, groups [2] | Yes (any note/canvas/.base) | Whatever the note renders (Dataview, Bases) | Via plugins | Plugin settings follow Obsidian's per-plugin pattern `.obsidian/plugins/<id>/data.json` [30]; the README only says "the Homepage pane of Obsidian's settings". Core bookmarks are `.obsidian/bookmarks.json` (replaced Starred in v1.2) [30]. Syncs only if config sync is on |
| Obsidian Bases (core, 2025) | Embed `![[X.base]]` or `![[X.base#View]]` in the home note [3][4] | n/a | Yes: `.base` YAML file | Live query over frontmatter + file props; data stays in .md [3][4] | Sort/filter/edit in views | `.base` file in vault (synced like content) |
| Obsidian Dataview / Datacore | Home note containing query blocks | n/a | Yes (query lives in note) | Query at render time over plugin index; `dv.pages()`; Datacore = React/JSX, `dc` hooks, reactive, up to 100x faster [5] | Yes (JSX state in Datacore) | In note text |
| Obsidian HTML viewer plugins | Open .html as a tab | n/a | Yes (.html file) | None (static) | Sandboxed iframe; scripts off by default (HTML Page Viewer) or on (HTML Experience); Borrax uses Electron webview + relative paths [6] | n/a |
| Logseq | `:default-home {:page "X" :sidebar [...]}`; Journals by default [7] | Favorites in left sidebar (right-click title) [8] | Yes (a page) | Advanced queries / plugin API | Limited | `logseq/config.edn` inside the graph folder, so it syncs with the files [7][8] |
| Notion | Home tab: Upcoming events, Recents, Favorites, Agents, Teamspaces, My Tasks; reorder/hide sections [9][10] | Favorites section in sidebar; mobile Favorites widget [9][11] | No (app UI) | Server DB | Yes | Per-user, server side |
| Anytype | Sidebar widgets as home | Pinned section; any Pin/Favorite can be a Link or an interactive Widget; Sets/Collections as widgets [12] | Objects, not files | Live object queries | Yes (widget feed) | Synced, except "Recently opened" is device-specific [12] |
| Tana | Home node = first node of workspace [13] | Pin any node to sidebar [14] | Node, not file | Live search nodes | Yes | Synced (cloud) |
| Capacities | Daily note as daily home base [15] | Sidebar | Object | Templates | Yes | Cloud |
| Trilium Notes | Any note can be a dashboard via **render note** | Launch bar | Yes (HTML code note + render note) | `api` object: `searchForNotes`, `getNote`, `runOnBackend` (frontend + backend scripts) [16][17] | Full JS, Preact/JSX or jQuery via `api.$container` [16] | Notes DB (synced) |
| SiYuan | Widget blocks | Dock/bookmarks | Yes: `{workspace}/data/widgets/<name>/` with `widget.json` manifest + `index.html` (+ icon), distributed via the bazaar [31] | Kernel HTTP API, e.g. `/api/query/sql` SELECT over blocks [18] | Full HTML/JS in an iframe block (same-origin kernel access is unverified) | Workspace folder, so it syncs with the data |
| TiddlyWiki | Default tiddlers | Tags/sidebar | Whole wiki is one HTML file | Live filter expressions `[tag[X]]` with list/count widgets [19] | Yes | Inside the HTML file |
| Claude Artifacts / MCP Apps | n/a | n/a | n/a | MCP Apps: `ui://` HTML talks JSON-RPC over postMessage: `tools/call`, `resources/read`, `ui/message`, `ui/update-model-context` [20] | Sandboxed iframe, full-site process isolation, strict CSP [21][22] | n/a |
| Observable Framework | Markdown page | n/a | Yes (.md + loaders) | Data loaders run at build, output a static snapshot [23] | Reactive JS | Repo |

## 2. Interactive HTML without duplicating data: the common pattern

All the live-data examples converge on the same three parts:

1. **Sandboxed frame.** An iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so the guest is an opaque origin and cannot touch the host's DOM, cookies or storage. A CSP `<meta>` delivered via `srcdoc` is parsed before guest code and cannot be removed by it [22]. Anthropic adds full-site process isolation [21]. Obsidian HTML viewers do the same, some keep scripts off until the user opts in [6].
2. **A message bridge.** The page asks the host for data over `postMessage`. MCP Apps standardise this as JSON-RPC with an `initialize` handshake, `tools/call`, `resources/read`, host context, size-change notifications and teardown [20]. This is the closest ready-made spec for Baalda: the dashboard could call the same read tools Baalda's MCP already exposes (`search_notes`, `list_notes`, `read_note`).
3. **A small read API over the existing index.** Trilium's `api.searchForNotes/getNote` [17], Dataview's `dv.pages()`, Datacore's `dc` hooks [5], Bases' `file.hasTag/file.inFolder/this` expressions [4], SiYuan's SQL endpoint [18], TiddlyWiki filters [19]. Data is queried at render time from the app's index; nothing is exported into the HTML.

Two contrasting approaches:
- **Declarative query file** (Bases `.base`, Dataview DQL): safe, AI-writable YAML, no code execution, limited UI.
- **Code with an API** (Trilium render notes, DataviewJS, Datacore, SiYuan widgets): full interactivity, but Trilium/DataviewJS run unsandboxed in the app context. Baalda should take the code route but keep the Artifacts-style sandbox.

Snapshot alternative: Observable Framework data loaders bake data into static files at build time [23]. That is the "duplicated JSON export" Baalda wants to avoid, though it is what most "Claude Code generated an HTML dashboard" workflows do today.

AI-native context: Karpathy's "LLM Wiki" gist made the pattern of an agent maintaining a markdown folder with its own index files popular in 2026 [24]. The Obsidian + Claude Code posts treat the vault as plain files the agent reads and rewrites [25]. None found ships an HTML dashboard that reads live vault data through a bridge; that gap is Baalda's opening.

## 3. Templates (what community dashboards pull)

Common widgets in Obsidian dashboards [26][27]:
- **Tasks due today / overdue** (Tasks plugin query across the vault).
- **Recently modified files**, sorted by mtime.
- **Favorites / quick links** and vault stats (note count, tags) via DataviewJS.
- **Charts, stats, embeds, link cards** in a 12-column grid (the "Dashboards" plugin, with Bases/SQL sources) [26].
- Homepage Dashboard plugin: discovers notes, tasks, journals and projects without a separate database [26].

Suggested Baalda starters, each needing only list/search/tags/links/mtime/frontmatter:
1. **Daily home**: today's journal link, open tasks (`- [ ]`) across notes, recently edited, pinned notes.
2. **Project tracker**: notes tagged `#project`, grouped by frontmatter `status`, with last-edited and backlink count.
3. **Reading list**: notes tagged `#book` with `author/rating/status` frontmatter as cards.
4. **Team pulse**: recently edited by teammates, new notes this week, orphan notes (no backlinks).
5. **CRM-lite**: notes in `People/` or tagged `#contact`, last-touched date, linked meeting notes.

## 4. Discovery of a new sidebar feature

- **Obsidian** opens a Release Notes tab automatically after every update since v1.0.0; some users asked for an off switch [28].
- **Notion** introduced Home as a sidebar entry with customisable sections [9].
- General SaaS pattern: a badge or dot on the menu item, slide-in card, or a "What's new" entry in Cmd+K; announce without hijacking the task, with read/unread state [29].
- Implication for Baalda: a one-time dot on the new Home button plus a pre-created starter dashboard is lighter than a modal.

## Sources
1. https://community.obsidian.md/plugins/homepage
2. https://obsidian.md/help/plugins/bookmarks
3. https://www.neowin.net/news/obsidian-190-launches-with-new-file-format-footnotes-view-plugin-and-more/
4. https://obsidian.md/help/bases/syntax
5. https://obsidian.rocks/getting-started-with-datacore/ ; https://community.obsidian.md/plugins/datacore
6. https://community.obsidian.md/plugins/html-page-viewer ; https://www.obsidianstats.com/plugins/borrax-html ; https://community.obsidian.md/plugins/html-experience
7. https://discuss.logseq.com/t/official-comprehensive-list-of-config-edn-options/4935
8. https://discuss.logseq.com/t/how-to-restore-favorites-on-the-left-sidebar/20093
9. https://www.notion.com/help/sidebar
10. https://thomasjfrank.com/notion-home-everything-you-need-to-know/
11. https://www.notion.com/help/mobile-widgets
12. https://doc.anytype.io/anytype/basics/sidebar/widgets
13. https://tana.inc/articles/showcase-home-node
14. https://tana.inc/docs/sidebar
15. https://outlinersoftware.com/topics/viewt/9918
16. https://docs.triliumnotes.org/user-guide/note-types/render-note
17. https://docs.triliumnotes.org/user-guide/scripts ; https://docs.triliumnotes.org/script-api/frontend/interfaces/Api
18. https://hermesagent.org.cn/en/docs/user-guide/skills/optional/productivity/productivity-siyuan
19. https://tiddlywiki.com/static/ListWidget.html
20. https://learn.traeai.com/t/ai-engineering/phases/13-tools-and-protocols/14-mcp-apps ; https://mcpbundles.com/blog/2025/11/24/mcp-apps-interactive-ui-protocol
21. https://simonwillison.net/2024/Aug/28/how-anthropic-built-artifacts
22. https://www.agentpatterns.ai/security/browser-sandbox-agent-generated-html/
23. https://observablehq.com/blog/data-loaders-for-the-win
24. https://www.aibuilderclub.com/blog/karpathy-llm-wiki
25. https://pasqualepillitteri.it/en/news/962/obsidian-claude-code-second-brain-persistent-memory
26. https://community.obsidian.md/plugins/dashboards ; https://community.obsidian.md/plugins/homepage-dashboard
27. https://thesweetsetup.com/creating-obsidian-dashboard
28. https://forum.obsidian.md/t/option-to-not-show-release-notes-after-update/61381
29. https://www.saasui.design/blog/saas-changelog-product-updates-ux-patterns
30. https://contextbolt.com/blog/obsidian-bookmarks/ ; https://obsidian.md/changelog/2023-05-02-desktop-v1.2 ; https://github.com/newcodejin/expanded-bookmarks
31. https://github.com/siyuan-note/widget-sample ; https://github.com/siyuan-note/bazaar

# Home and dashboards

Baalda renders. It never generates. A dashboard is an ordinary `.html` or `.htm`
note in your vault. You or your agent author the page; Baalda displays it, watches
for edits, and synchronizes it through the existing note access model. Markdown
notes remain the source material. There is no exported dashboard database.

When no Home is set, the sidebar's **Set a home** template flow creates the file,
assigns it as your personal Home, and opens it with the sidebar visible. The
sidebar Home action can then enter the full-width view explicitly. Ordinary **New
dashboard** creation keeps Home assignment optional. Its completion screen offers
installed Claude/Codex actions; copying an agent prompt is the fallback when
neither provider is available. If Home setup fails after the file was created,
retry finishes setup without creating or overwriting the file again.

## Getting started

Use the sidebar Home row's options to change Home, or choose Set a home to open
the template dialog when no Home is available. Choose Daily home, Project tracker,
Reading list, Team pulse, CRM-lite, or Blank, then a name and folder. These are
static examples, with an editing guide in their HTML comment. Creation only
happens after you click Create; existing files are never overwritten.

HTML dashboards open directly as pages, without a second Preview/Source toolbar.
Update with Claude and Update with Codex appear beside the main navigation's
app actions only while the current effective Home is open, including Markdown,
HTML and linked Home notes (shortened to provider names in narrow windows).
Other HTML pages offer Dashboard options (`···`) with View source and Set as my
home; Home itself has no overflow menu. Source mode
keeps Save and Back to dashboard controls. You can also use Baalda's MCP tools
or let an agent edit the file on disk.
The watcher reloads the open preview after the file changes. Pages using the SDK
restore scroll and can retain widget state on this device.

Any note can be Home. Set as my home creates a device-local override; vault
owners/admins can set a shared vault home. Your override takes precedence. An available Home
opens when the vault opens, and Cmd/Ctrl+Shift+H returns to it. With no available
Home, Set a home opens the dashboard template dialog. The sidebar Home options
open the chooser for existing notes. The chooser lists HTML and linked
dashboards, with Home first and pinned dashboards before the remaining files;
there is only one effective Home.

The sidebar's labeled Home section shows that effective Home note above Pinned,
or offers Set a home when it is unavailable. That action opens the template
dialog; creating a dashboard and choosing Set as my home remain explicit steps.
Home navigation lives in the sidebar; there is no duplicate top-bar Home icon.

Hiding the Home section (or turning off Show Home section in Account Settings)
unsets this device's personal Home and disables Home startup, keyboard navigation,
and dashboard Home actions while hidden. Shared vault Home settings stay intact
for teammates. Showing the section again offers Set a home or the shared vault
Home; choosing a Home explicitly shows the section again. Older saved personal
Home choices are cleared when a vault opens with Home hidden.

Startup and explicit Home navigation highlight only this shortcut, without
revealing or expanding the source file in Notes. Opening that file directly
restores ordinary file selection and folder reveal.
Activating the sidebar Home row explicitly opens Home with the sidebar collapsed.
Opening the same note through a tab, file tree, keyboard shortcut, or startup
keeps the sidebar visible. Assigning Home alone does not collapse it. This applies
to every Home format, including Markdown. The effective Home omits the redundant
Set as my home action, whether chosen personally or inherited from the vault.

The sidebar Home row's options (also available by right-click) include Unset
Home for a personal Home. Clearing it does not delete the note. If a shared
Home exists, the action instead says Use vault Home instead because clearing
the personal override reveals the shared Home. Vault owners/admins can also
Unset vault Home for everyone; members cannot clear the shared setting.

Setting Vault Home automatically makes the chosen file readable to every current
vault member, without another prompt. Home adds ordinary view grants rather than
a lock, so existing editing access (including owner/admin access) is preserved.
Members excluded by file, folder, or vault permissions receive a read-only share
on that file. Existing view/edit access is preserved; the parent folder and other
files are not shared. These remain normal
editable permissions, not a Home-only authorization bypass. Setting Home again
restores read access for anyone excluded since it was last set.

The sidebar toggle can reveal Home's sidebar after explicit Home navigation.
Leaving that visit clears its full-width state: returning through a tab or file
opens normally. Refresh also shows Home's sidebar, independently of the usual
sidebar preference for other notes. Home browsing does not change that preference.

File-tree row menus group dashboard creation and links under Dashboard, pinning
under Pin, and personal/shared Home choices under Home. Flyouts open on hover
or click; arrow keys navigate them, Enter activates, and Escape returns or closes.

Pin notes or folders from their row menu. Personal pins live on this device.
Owners/admins can also pin for everyone; shared pins appear first and members
cannot remove the shared pin. Personal duplicates appear only once. Note pins and
Home use the stable note ID, so a recognized rename or move keeps the reference.
Folder pins follow moves made in Baalda and folder moves recognized by sync.
Unavailable pins are hidden without erasing saved references during an incomplete
listing, startup, or loss of access; a restored note with the same ID reappears.

Local external note moves retain IDs when the filesystem supplies reliable file
identity and creation time. Identical copies keep separate IDs. On filesystems
without that metadata, use Baalda's rename/move action or the existing sync
reconciliation rather than relying on local external move recognition.

## Agent paths

- **MCP:** create or update an HTML note with the normal note tools. Dashboard
  content uses the same permissions and sync as other notes.
- **Files:** run your agent in the vault and edit the HTML directly. Baalda's
  watcher picks up the change.
- **Routines:** configure your agent's scheduler to edit the file or use the
  Baalda MCP connector. Scheduling belongs to the agent; Baalda adds no scheduler.
- **Installed agents:** On the effective Home, Update with Claude and Update with Codex each open a
  prompt and streaming log for that installed CLI. Stop cancels the process and
  its children. Detection and compatibility appear under Account Settings → About.
  Sign in through the CLI first; Baalda never opens credential files. Inherited
  API credentials can select API billing instead of the CLI subscription.

Codex requires CLI 0.160.1 or newer and the supported named permission-profile
flags. Its dedicated profile permits vault content but denies the vault-root
paths `.context`, `.git`, `.env`, `.claude`, `.codex`, and `.agents`, including
their contents. These are specific paths, not a blanket denial of every hidden
file or nested `.env` file. Agent tools cannot access outside the vault apart
from the CLI's minimal runtime, and their network access is disabled. The CLI
itself still connects to its model service. Codex ignores user configuration
and execution-policy rules, disables hooks/plugins/apps, and skips session
rollout persistence. The exact user config excluded by `--ignore-user-config`
is not mistaken for a project config when the vault lives under the user's home.
Separate project, system, and forced managed configuration still cause a refusal
using presence checks, without reading their contents. Organization policy
fetched by the CLI also applies.

Claude requires the installed CLI's `--restricted`, `--safe-mode`, headless and
permission-control flags. Restricted mode confines its file tools to the vault's
working directory; Baalda exposes only Read, Glob, Grep, Edit and Write. This is
Claude Code's tool-permission boundary, **not an OS sandbox**. Shell, code,
subagent, web and MCP tools are unavailable. Private vault-root paths listed
above have explicit Read and Edit denials; Claude applies Read denials to Write
and best-effort search filtering as well. Permission prompts are automatically
denied rather than bypassed. Safe mode disables user customizations while
preserving CLI authentication; managed policy still applies. No-session-persistence
keeps the conversation from being saved. Baalda does not use `--bare`, which would
disable subscription/keychain authentication.

Home can be any supported note format, including Markdown, HTML, canvas, and
`.url`/`.webloc` app links. The runner preserves that format. For linked apps or
Next.js projects it follows the vault map to local source files inside the vault;
it cannot update a remote host without those sources and does not replace a URL
shortcut with generated HTML. Missing local sources are reported.

Both providers start in the currently open vault root and receive the same prompt
over stdin without a shell command string. The prompt explicitly asks them to read
root `AGENTS.md` (or lowercase `agents.md`) and `CLAUDE.md` when present, follow the
vault map to relevant notes, JSON, schemas and dashboard API comments, and read
applicable nested instructions before editing files. This scoped, explicit reading
does not re-enable automatic CLI customization, hooks or configuration. A requested
update may change both the dashboard and its supporting user-content data; unrelated
files, note identities and source values must be preserved. Instructions and linked
files cannot override the vault/private-data boundaries. Missing context should be
reported rather than invented. These are agent instructions; the CLI boundaries
above remain the access controls.
Displayed logs stay in memory and include only selected text events. Closing
the dialog or navigating within the vault leaves an update running. Provider
buttons are hidden away from Home; return to Home to see progress/completion
and click the matching provider to reopen the same request and
output, with the original target file shown in the header. Only one update runs
at a time. Stop explicitly cancels it; changing vaults cancels and clears its
session. App shutdown also ends the process. Changes
already written remain in the vault and sync normally. Unsupported CLI versions
show their compatibility requirement rather than silently running without these
boundaries. See the official [Codex non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
and [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference).

## Optional live bridge

A handwritten page needs no SDK. Include the following only when you want live
reads, app navigation, theme tokens, scroll restoration, or device-local state:

```html
<script src="/__baalda/sdk.js"></script>
<script>
  baalda.ready.then(async () => {
    const notes = await baalda.notes.list({ tag: "project", limit: 50 });
    const list = document.querySelector("#projects");
    for (const note of notes) {
      const button = document.createElement("button");
      button.textContent = note.title;
      button.onclick = () => baalda.app.open({ docId: note.id });
      list.append(button);
    }
  }).catch(console.error);
</script>
<div id="projects"></div>
```

Use `textContent` for note text rather than inserting unsanitized HTML. All
methods return promises and may reject, for example after a vault switch or
permission change.

| API | Result / arguments |
| --- | --- |
| `baalda.ready`, `baalda.vault.info()` | Vault name, user display name, platform, theme, CSS tokens |
| `baalda.notes.search(q, limit)` | Search results for readable notes; at most 200 |
| `baalda.notes.list(query)` | Note metadata: `id`, `path`, `title`, `mtime` (Unix seconds), `frontmatter` (JSON string or null), `tags` |
| `baalda.notes.read(note)` | Note source text |
| `baalda.notes.meta(note)` | Metadata for one note, or null |
| `baalda.notes.backlinks(note)` | Readable backlinks |
| `baalda.graph.edges()` | Links whose endpoints are both readable |
| `baalda.tags.list()` | `{name, count}` rows |
| `baalda.properties.keys()` | `{key, count}` rows |
| `baalda.properties.values(key)` | Distinct scalar values as strings |
| `baalda.vault.stats()` | Local vault health, or readable-note counts/activity for a synced vault |
| `baalda.state.get(key)`, `baalda.state.set(key, value)` | JSON widget state, device-local per dashboard; 64 KB total |
| `baalda.app.open(note)` | Open a readable note in Baalda |
| `baalda.app.openExternal(url)` | Open an HTTPS or mailto link in the system handler |

`note` accepts a path string, `{path: "Projects/Plan.md"}`, or `{docId: "…"}`.
`notes.list` accepts `folder`, `tag`, `property: {key, value}`, `modifiedSince`
(Unix seconds), `sort` (`path`, `title`, `modified-desc`, `modified-asc`),
`extensions`, and `limit` (0–200). Filters combine. Use filtered lists for large
vaults: aggregate tags/properties/stats are bounded to 10,000 readable notes.

The SDK applies `data-theme` and `--bg`, `--fg`, `--surface`, `--muted`, `--accent`,
`--accent-soft`, `--border`; updates follow the app theme. It relays app keyboard
shortcuts, including Cmd/Ctrl+K, and internal note links. `__scroll` is reserved
for scroll restoration. Widget state is separate from editor UI state and never
changes note content or syncs to teammates.

Local-only bridge reads work offline. In a synced vault the bridge requires a
fresh server-readable listing and fails closed when that listing is unavailable.
The saved HTML itself can still render offline. UI title caches are not authority.

## Runtime boundaries

Local pages run in an opaque-origin iframe with scripts and popup links enabled.
They receive neither same-origin access nor Tauri IPC. A separate `baalda-view`
protocol supplies the mounted HTML and local presentation assets, with an epoch
and per-view lease. Paths reject traversal, hidden metadata and symlink escape;
switching vaults invalidates the view. Raw notes are available only through the
authorized bridge.

Relative image/media paths work, including `./attachments/image.png`. Guest CSP
allows inline scripts/styles and scripts from cdnjs, jsDelivr and unpkg, with
Google Fonts styling/fonts. Fetch, WebSocket, nested frames, forms, and arbitrary
remote images are blocked. Popups and allowed CDN scripts remain capabilities
of the page; the sandbox is not a guarantee against every form of outbound
navigation. The main app's script policy stays `script-src 'self'`.

Host messages must come from the mounted iframe and its opaque origin. Methods,
request sizes, response sizes and concurrent requests are bounded. Old frames
cannot act on a newly opened vault. Read-only means the page cannot edit notes;
state storage and app navigation are the deliberate exceptions.

## Linked dashboards

Add dashboard from link creates a portable text `.url` note:

```ini
[InternetShortcut]
URL=https://example.com/dashboard
```

XML `.webloc` shortcuts are also readable; binary plist shortcuts are unsupported.
Both formats can be Home, pinned, shared and edited as ordinary notes. Links must
use HTTPS without embedded credentials. All valid HTTPS website links are previewed without a separate provider permission step. Remote pages receive no vault bridge. Open in browser is always available.
Claude and ChatGPT pages known to block iframe embedding load automatically in
an unprivileged native child webview inside the current tab. Their HTTPS origin,
sign-in requirements, and security headers are preserved. The viewer follows the
tab bounds and closes when that tab unmounts; unique viewer labels guard against
late cleanup closing a newer tab. Native views sit above DOM layers, so the viewer
is temporarily hidden while an app menu, dialog, or agent panel is open, then
restored without reloading. Provider outages or authentication can still prevent
the page loading. Other sites may also block embedding; Open in browser remains
available. Browser simulation covers the host layout only, not native rendering.

## Development verification

### Imported template library and previews

The library contains 26 templates: 20 upstream dashboard templates, three original
Baalda Agentic OS templates (Orbit, Waystation, and Meridian), and three adapted
user-supplied deployments (Cosmos, Sales OS, and Marketing OS). Bundled HTML,
styles, scripts, fonts and images live in `app/apps/desktop/public/dashboard-templates/`.
`SOURCES.json` records repositories, revisions, source-page hashes and final artifact
hashes for the upstream imports; adjacent license files retain attribution. The
20 imports preserve their upstream designs. Legacy personal starter files remain
in source but are not in this catalog.

The three deployment adaptations retain the supplied interfaces and replace the
original business/customer data with fictional sample workspaces. `DEPLOYMENTS.json`
records source URLs and hashes; `deployed-os-NOTICE.txt` records attribution and
bundled dependency licenses. Cosmos preserves the orbital graph, search, inspectors,
briefing, radar, and command console. Sales OS has seven sections with call briefs,
pipeline charts, decisions, context, and playbooks. Marketing OS has ten pages,
six palettes, and the original canvas core. They make no network requests and do
not connect to the original services. Demo decisions, captures, and tasks last for
the current visit only. Playbook actions display copyable prompts for use with a
separately configured agent. Cosmos and Marketing OS start dark; Sales OS starts
light. Each includes an explicit theme control. Reduced-motion preferences and
motion controls are preserved.

Orbit is a self-contained HTML note with Command, Missions, Skills, Memory,
Signals and Activity pages. It includes dark/light themes, an original Canvas
particle sculpture, sample reports and session-only simulated skill runs. Its
`DEMO` object is the customization entry point. It makes no network requests,
launches no agents and does not modify vault data. Saved copies start in dark mode
regardless of the host theme; the user can choose light mode for that visit. Animation uses a single
timestamp-based `requestAnimationFrame` loop, precomputed edges, capped pixel
density, visibility gating and the system reduced-motion preference; a pause
control is also available. Fonts and their OFL notices are embedded in the HTML.

Design research: the [Agentic OS walkthrough](https://www.youtube.com/watch?v=EOdXR6lU5ZA)
informed the separation of workflows, knowledge and outputs. Orbit is an original
implementation, not a copy of its UI or source. Animation decisions follow
[MDN performance guidance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Fundamentals)
and [reduced-motion support](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion).

Gallery cards use 900 × 900 WebP screenshots in `public/dashboard-thumbnails/`.
They are captured from the corresponding bundled HTML at a 1200 × 1200 viewport,
then downsampled and compressed. Regenerate the matching thumbnail when updating
a template. Card images are lazy-loaded and asynchronously decoded. No card mounts
an iframe or starts chart scripts. Only clicking Preview mounts the interactive,
sandboxed HTML; returning to the library unmounts it. For a recognized saved
dashboard, the expanded preview opens the vault file so edits remain visible.
Card images represent the original template, not a live snapshot of user edits.

Native template previews use the separate `baalda-view` protocol's fixed
`/__baalda/template/<id>` allowlist and guest CSP, without a vault SDK bridge.
The simulator serves the same bundled HTML directly. Public assets avoid Vite
rewriting these self-contained pages as application entry points. Existing vault
HTML with the old template-credit banner has that banner hidden during rendering.

Bundling preserves upstream design and license notices, inlines dependencies,
removes remote tracking, and provides session-only storage for opaque previews.
Webpack eval wrappers are expanded into scoped functions to fit the guest CSP.
Tabler uses MIT-licensed ApexCharts 4.2.0 (its license is included). Malformed font
source declarations and Light Bootstrap's leftover Sass sidebar-width expression
are repaired for browser parsing. Agent prompts require replacing demo values with
supported vault facts rather than inventing metrics.

Validate imported CSS, inline JavaScript, offline dependencies, size limits and
thumbnail availability with `node scripts/verify-dashboard-templates.mjs` from
`app/apps/desktop/`.

### Checks

Run desktop tests, Rust tests and the relevant server authorization/appearance
suites against a disposable database. Inspect Windows and macOS simulator layouts
at normal and narrow widths. A simulator or `tauri dev` cannot verify packaged
CSP: use a packaged app to check inline/SDK scripts, relative images, blocked
fetch, keyboard relay, and watcher reload with state/scroll restoration. Native
Windows WebView2 and actual two-device sharing require separate checks.

New dashboards and linked dashboards default to the root `Dashboards` folder,
reusing its existing spelling or creating it on save. The destination remains
editable. Linked dashboards open directly after saving; their `.url`/`.webloc`
extensions are hidden in navigation labels. Website previews show a provider-aware
loader until the frame loads and place browser actions over the page. Native
Claude/ChatGPT viewers retain actions in app chrome because native views sit above
DOM overlays.

Dashboard chat closes on outside clicks, including the embedded page, while keeping
its draft and any running update. Chat and Activity replace each other. Sending a
message clears the composer immediately; the next draft stays editable and survives
completion. Paper and Material templates receive a scoped 24px top inset in both
new templates and rendered saved copies; rendering does not rewrite vault files.


### Waystation and Meridian

Alongside Orbit, the Agentic OS category includes two more original Apache-2.0
HTML templates. All three start dark independently of the host and have an explicit
light-mode toggle. Their sample interactions last for the current visit only.

- **Waystation** is an original SVG isometric studio: six selectable stations,
  four walking couriers, a work queue, routine toggles, and a searchable archive.
  A demo request clears the composer, moves through draft/review, and adds a sample
  artifact. Selecting either a desk or a roster entry selects the same station.
- **Meridian** organizes apps, routines, memory, and skills around an interactive
  artifact atlas. It includes a sample calendar and inbox, live timezone clocks,
  a filtered artifact library, memory collections, agent/effort selectors and
  simulated skill runs that add reviewable outputs.

Neither template executes agents, schedules background tasks, connects accounts,
changes permissions, or sends network requests. Their `DEMO` objects and top-of-file
comments are the customization entry points. Both embed their fonts and license
notices. Motion can be paused, respects reduced-motion settings, and stops when
hidden or out of view. Waystation uses a timestamp-based animation loop; Meridian
uses CSS transforms for its orbital markers.

Concept research: the user-provided isometric workspace screenshot and
[the RoboNuggets Agentic OS walkthrough](https://www.youtube.com/watch?v=8NSyI-npJCU),
reviewed through its full transcript and dashboard visuals. The four-part structure
informed Meridian; the artwork, names, layouts, code and sample content are original.

The shared template-spacing stylesheet also restores symmetric responsive gutters
for Star Admin, Purple Admin, Majestic, Sneat, and PlainAdmin. Majestic's header,
tabs, report button and charts share the same outer inset. The native renderer
injects the current rules into saved templates without rewriting the vault file.

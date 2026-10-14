# Research: headless agents + scheduled routines + sandboxed HTML dashboard

Written to this plan file because plan mode was switched on mid-task and blocks writes to the scratchpad path the lead asked for. Verified 2026-10-11 against local CLIs on this Mac (Claude Code 2.1.296 at `~/.local/bin/claude`, codex-cli 0.160.1 via nvm, gemini via Homebrew) plus the docs cited inline.

---

## 1. Running Claude Code and Codex headless from the desktop app

### 1.1 Claude Code

**Command we would spawn** (cwd = vault folder):

```bash
claude -p "<prompt>" \
  --output-format stream-json --verbose \        # NDJSON events; last line is {"type":"result",...}
  --permission-mode acceptEdits \                # or dontAsk for locked-down runs
  --allowedTools "Read,Edit,Write,Glob,Grep,mcp__baalda__*" \
  --permission-prompts none \                    # unattended: deny anything that would prompt, don't retry (>= v2.1.259)
  --mcp-config /path/to/0600-baalda-mcp.json --strict-mcp-config \
  --append-system-prompt "<dashboard rules>" \
  --model sonnet --max-budget-usd 1 \
  --add-dir <extra dir>                          # optional
# follow-ups: --resume <session_id> (from the json result) or --continue
# structured output: --output-format json --json-schema '<schema>' -> .structured_output
```

- Source: https://code.claude.com/docs/en/headless. It says `-p` exits 0 on success. Failures inside the run, such as missing auth, print as the result on stdout. `--output-format json` includes `session_id`, `total_cost_usd` and `result`. The `system/init` event lists `mcp_servers` with status plus `mcp_server_errors`, so the app can tell when the Baalda MCP failed to load.
- `--max-turns` does not appear in the current local `--help`. Use `--max-budget-usd` as the cap instead.
- `--dangerously-skip-permissions` exists, but the docs say to use it only in sandboxes with no internet. Prefer `acceptEdits` or `dontAsk` plus `--allowedTools`.
- SIGTERM exits with code 143 and kills child Bash trees. SIGINT ends the turn cleanly. Use SIGINT for a "Stop" button.
- MCP config JSON for a remote HTTP server:
  `{"mcpServers":{"baalda":{"type":"http","url":"https://api.baalda.com/api/mcp","headers":{"Authorization":"Bearer mcp_…"}}}}`.
  Write it to a 0600 temp file, not argv, because argv is visible in `ps`. `--strict-mcp-config` ignores the user's other servers.

**Auth (the important part):**
- Without `--bare`, `claude -p` uses whatever login the user has, including the Claude.ai Pro or Max subscription OAuth stored in the keychain. The docs imply this: "Set `ANTHROPIC_API_KEY` before running it, because bare mode doesn't use your subscription login." An `ANTHROPIC_API_KEY` in the environment takes precedence over the subscription (routines doc, troubleshooting).
- **Do not pass `--bare`.** Bare mode never reads OAuth or the keychain, so the user's subscription would stop working.
- Detect login state with `claude auth status`. This exists locally, though its output format was not checked.
- **Policy caveat:** the Agent SDK overview says "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" (https://code.claude.com/docs/en/agent-sdk/overview). Spawning the user's own installed `claude` binary, which the user logged into themselves, is the pattern most third-party GUIs use, such as opcode and Obsidian plugins. Embedding the Agent SDK and offering a "sign in with Claude" flow is what the note forbids. Recommendation: shell out to the user's CLI, never bundle the SDK with subscription auth, and never call the product "Claude Code" in the UI. The branding rules allow "Claude Agent" or "<Name> Powered by Claude".
- Agent SDK alternative: TypeScript `@anthropic-ai/claude-agent-sdk` and Python `claude-agent-sdk`. It runs the Claude Code binary as a library and needs an API key for third-party products. It is not worth it here, because our UI is TypeScript in a webview with no Node runtime, so it would need a Node sidecar.

**Detection:**
1. Call `fix_path_env::fix()` at startup (see 1.4). Then run `claude --version`, which prints e.g. `2.1.296 (Claude Code)`.
2. If that fails, probe known install paths:
   - `~/.local/bin/claude` (native installer, which is what this Mac uses)
   - `~/.claude/local/claude` (older local install)
   - `/opt/homebrew/bin/claude` and `/usr/local/bin/claude`
   - `$(npm prefix -g)/bin/claude` and `~/.nvm/versions/node/*/bin/claude`
   - Windows: `%USERPROFILE%\.local\bin\claude.exe`, `%APPDATA%\npm\claude.cmd`
3. Login check: `claude auth status`. The `~/.claude/` directory existing only proves the CLI has been run at least once.

### 1.2 OpenAI Codex CLI

```bash
codex exec "<prompt>" \
  -C <vault dir> --skip-git-repo-check \        # vaults usually aren't git repos
  --sandbox workspace-write \                    # read-only is the default
  --json \                                       # JSONL: thread.started, turn.started, item.*, turn.completed
  -o /tmp/last.txt \                             # --output-last-message
  --output-schema schema.json \                  # optional structured result
  -m <model> --ephemeral                         # optional
# resume: codex exec resume --last "<task>" | codex exec resume <SESSION_ID>
```

- Source: https://learn.chatgpt.com/docs/non-interactive-mode, which `developers.openai.com/codex/noninteractive` redirects to.
- **`--full-auto` is deprecated.** Use `--sandbox workspace-write` instead. `--dangerously-bypass-approvals-and-sandbox` is for externally sandboxed environments only. 0.160 also has `--approve-for-me`.
- **Auth:** `exec` reuses the saved CLI login. That covers both a ChatGPT plan login from `codex login` and an API key. `CODEX_API_KEY` works inline for one invocation. The docs say a ChatGPT login cannot be started headless, so the user must run `codex login` once interactively.
- Detect login state with `codex login status`. `~/.codex/auth.json` exists once the user has logged in.
- **MCP:**
  ```bash
  codex mcp add baalda --url https://api.baalda.com/api/mcp --bearer-token-env-var BAALDA_MCP_TOKEN
  ```
  This writes a `[mcp_servers.baalda]` entry in `~/.codex/config.toml` with `url` and `bearer_token_env_var`. For a per-run setup that leaves the user's config alone, pass it with `-c` instead:
  `-c 'mcp_servers.baalda.url="…"' -c 'mcp_servers.baalda.bearer_token_env_var="BAALDA_MCP_TOKEN"'`
  and put the token in the child's environment.
- **Detection:** `codex --version`. On this Mac it lives at `~/.nvm/versions/node/v24.12.0/bin/codex`, which a GUI app will NOT find without the PATH fix. It can also come from Homebrew or the npm `@openai/codex` package.

### 1.3 Gemini CLI (from local `gemini --help`; docs not checked)
- The prompt is now positional, because `-p` is deprecated: `gemini "<prompt>" -o json|stream-json --approval-mode auto_edit|yolo --allowed-mcp-server-names baalda --include-directories <dir>`.
- Login is cached Google OAuth, or `GEMINI_API_KEY`. This auth detail was not checked in the docs.

### 1.4 Spawning from Tauri v2
**Recommendation: a Rust command behind `invoke`, not tauri-plugin-shell.**
- The shell plugin scopes every program and argument in capabilities. Its example is `{"identifier":"shell:allow-execute","allow":[{"name":"exec-sh","cmd":"sh","args":["-c",{"validator":"\\S+"}],"sidecar":false}]}` (https://v2.tauri.app/plugin/shell/).
- A free-text prompt argument needs a catch-all validator. Exposing the shell plugin to a webview that also renders AI-authored HTML widens the attack surface.
- Instead, add a typed `run_agent({agent, prompt, vaultId})` command in Rust. It builds the argv itself, resolves the binary path once, and sets cwd to the vault root with `resolve_in_vault`-style checks. It spawns with `tokio::process::Command` (`kill_on_drop(true)`), reads stdout line by line, and streams NDJSON events to the UI over a `tauri::ipc::Channel<AgentEvent>`, which is better than global events for a single caller. Cancel sends SIGINT for Claude, then SIGTERM after a timeout.
- **macOS PATH:** apps launched from Finder or the Dock get the minimal launchd PATH, so Homebrew, nvm and `~/.local/bin` are missing. Real report: opcode, a Tauri GUI for Claude Code, issue https://github.com/winfunc/opcode/issues/58 ("env: node: No such file or directory"). Fixes:
  - `fix-path-env = { git = "https://github.com/tauri-apps/fix-path-env-rs" }` and `let _ = fix_path_env::fix();` first thing in `main`. It reads the login shell's PATH.
  - Also add the explicit fallback probes from 1.1.
  - npm-installed `claude` and `codex` are Node scripts with `#!/usr/bin/env node`, so the fixed PATH must also contain node. With nvm, it is the same bin directory.
- **Windows:** npm shims are `.cmd` files. Spawn `claude.cmd` explicitly, or resolve with the `which` crate, which handles PATHEXT.
- **Permission UX seen elsewhere:**
  - Zed, Raycast and Warp detect the binary and show "Install / Sign in" with the exact terminal command when it is missing or logged out.
  - Obsidian "Claude Code" plugins spawn the user's CLI with cwd = vault.
  - Pattern for Baalda: a per-agent row in Settings showing "Detected: Claude Code 2.1.296, signed in", a Test button, an explicit toggle per vault, and every run logged in Activity.

---

## 2. Scheduled "every morning at 8, regenerate my dashboard" with Baalda MCP

**Key fact:** Baalda's server already implements MCP OAuth (`app/apps/server/src/mcp/oauth.ts`, table `mcp_oauth_vault`). Baalda is already usable as a claude.ai connector; this research session itself shows `mcp__claude_ai_Baalda__*` tools. claude.ai custom connectors support OAuth, no auth, or static credentials ("fixed credentials such as API keys… bearer token"), on Free, Pro, Max, Team and Enterprise plans (Free is limited to one connector) (https://support.claude.com/en/articles/11175166). So every cloud option below can reach `POST /api/mcp`.

| Option | Runs where | Machine on? | Reaches Baalda remote MCP? | Notes |
|---|---|---|---|---|
| **Claude Code cloud routines** (`/schedule`, claude.ai/code/routines, Desktop "New routine → Cloud") | Anthropic cloud | No | **Yes, as a claude.ai connector.** "all of your connected MCP connectors are included by default". Connector traffic goes through Anthropic, so no network allowlist is needed | Pro, Max, Team and Enterprise. Minimum interval 1 hour. Draws subscription usage. A routine needs a GitHub repo to clone, but the prompt can ignore it. Also has an API trigger: `POST …/routines/<id>/fire` with a bearer token, which Baalda could call. https://code.claude.com/docs/en/routines |
| **Claude Desktop local scheduled tasks** (Code tab → Routines → Local) | User's machine | Yes, and the app must be open | Yes, through MCP config files and connectors | Minimum 1 minute. One catch-up run after sleep. Each task has its own permission mode, and a Manual-mode task stalls until approved. Stored in `~/.claude/scheduled-tasks/<name>/SKILL.md`. Works on the local `.html` file directly. https://code.claude.com/docs/en/desktop-scheduled-tasks |
| `/loop` / CronCreate | Inside an open CLI session | Yes, and the session must be open | Inherits the session's servers | Recurring tasks expire after 7 days. Not durable. https://code.claude.com/docs/en/scheduled-tasks |
| **Codex scheduled tasks ("automations")** | Desktop app: local. Web: cloud | Local tasks need the computer on and the app running | Not documented for scheduled tasks specifically. The Codex app supports MCP servers and plugins | Schedules from minutes up to RFC 5545 rules, plus Gmail, Slack and GitHub event triggers. Uses the default sandbox settings. https://learn.chatgpt.com/docs/automations?surface=app |
| OS cron / launchd / Task Scheduler running `claude -p` or `codex exec` | User's machine | Yes | Yes, through `--mcp-config` or `[mcp_servers]` | The simplest thing Baalda could install itself. A launchd plist with `StartCalendarInterval` must set PATH explicitly, for the same GUI PATH problem. Uses the subscription login from the keychain. |
| GitHub Actions + Claude Code or Codex Action | GitHub | No | Yes: an `--mcp-config` with the token from secrets | Needs `ANTHROPIC_API_KEY` or an OAuth token secret. Overkill for consumers. |
| n8n / Make | Their cloud | No | Yes, both have MCP client nodes that accept a bearer header | Not verified in this pass. |

**Simplest for Baalda users:**
- **Signed in to claude.ai:** a cloud routine whose prompt is "Using the Baalda connector, read notes X, Y, Z and update `Home.html` via `update_note`". It runs with the laptop closed, and the edit fans out live through `createDocWriter`.
- **Local, offline-capable:** Baalda itself schedules a launchd job or an in-app timer that spawns `claude -p` / `codex exec` with the Baalda MCP config.
- Both converge on the same MCP write path, which keeps the CRDT invariants intact.

---

## 3. Rendering AI/user-authored interactive HTML safely in the Tauri webview

### 3.1 Baalda-specific blocker for `srcdoc`
- **A `srcdoc` or `blob:` iframe inherits the embedding document's CSP**, per web-platform-tests `content-security-policy/inheritance/iframe-all-local-schemes*`.
- The packaged app's CSP (`tauri.conf.json` line 28) has `script-src 'self'`, so **every inline `<script>` in a srcdoc dashboard would be blocked in production builds**, plus any CDN script. Adding `'unsafe-inline'` to the parent CSP would weaken the main app.
- Tauri injects the CSP only in packaged builds, so srcdoc would *work in `tauri dev` and break in release*. CLAUDE.md already warns that dev never exercises the CSP.

### 3.2 Recommended design: custom URI scheme + opaque-origin sandbox
1. **Register an asynchronous URI scheme protocol**, e.g. `baalda-view`, with `Builder::register_asynchronous_uri_scheme_protocol` (https://docs.rs/tauri/latest/tauri/struct.Builder.html).
   - URLs are `baalda-view://localhost/<vaultId>/<path>` on macOS and Linux, and `http://baalda-view.localhost/<vaultId>/<path>` on Windows and Android (`use_https_scheme` switches the latter to https).
   - The handler serves vault files through the same `resolve_in_vault` checks. It refuses `.context/`, dotfiles and anything outside the vault, and serves only `ALLOWED_EXTS` with the right `Content-Type`.
   - On HTML responses it sets **its own** `Content-Security-Policy` header. Because the frame is a network-style navigation, not a local scheme, it does not inherit the app CSP.
2. **Embed it** as `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms" src="baalda-view://localhost/…/Home.html">`, with **no `allow-same-origin`**.
   - The document gets an opaque origin, so it cannot reach `window.parent`, Tauri IPC (`__TAURI__`, `ipc:`), the app's localStorage or cookies.
   - Relative URLs like `./attachments/img.png` still resolve against the document URL and load through the same protocol. Image and CSS loads don't need CORS.
   - Any `fetch()` from the opaque origin to the scheme would need `Access-Control-Allow-Origin: null`. Either avoid that or set it deliberately for read-only assets.
3. **Parent CSP change:** add the scheme to `frame-src` only: `baalda-view: http://baalda-view.localhost https://baalda-view.localhost`. Extend `src/__tests__/csp.test.ts`, which pins the CSP, to match.
4. **Frame CSP**, sent by the protocol handler and pinned by a test:
   ```
   default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com;
   style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:;
   img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'none'; form-action 'none';
   frame-src 'none'; base-uri 'none'
   ```
   - Its `'self'` refers to the scheme origin, so it serves vault images.
   - `connect-src 'none'` stops exfiltration of vault data through fetch, XHR or WebSocket. Claude.ai Artifacts use the same model: sandboxed iframe, process isolation, strict CSP limiting network access to an allowlist of CDNs (https://simonwillison.net/2024/Aug/28/how-anthropic-built-artifacts).
   - CDN scripts listed in the allowlist load. Any other `<script src>` is blocked and logged as a CSP violation, so the AI prompt should name the allowed CDNs.
   - **Belt and braces:** also inject the same policy as a `<meta http-equiv="Content-Security-Policy">` at the top of `<head>`. Simon Willison (2026-04-03, Chromium + Firefox) showed that JS in a `sandbox="allow-scripts"` frame cannot remove or escape a meta CSP: it is enforced at parse time and survives navigation to `data:` (https://simonwillison.net/2026/Apr/3/test-csp-iframe-escape/). WebKit was not part of that test.
5. **Host API through `postMessage`**, request/response with ids:
   - Frame sends `{v:1, id, method:"readNote"|"search"|"openNote"|"openExternal", params}`.
   - Host checks `event.source === iframe.contentWindow`. `event.origin` is the string `"null"` for an opaque origin, so check the source, not the origin. The host then enforces a method allowlist and replies `{id, ok, result|error}`.
   - Inject a tiny client shim into the served HTML. Keep the API read-only plus navigation. Writes go through MCP agents, not the page.
6. **Links:**
   - `allow-popups` plus a host-side handler. Intercept `target=_blank` and `window.open` via the shim → `postMessage({method:"openExternal", url})`. The host validates `https:`/`mailto:` and calls the existing `tauri-plugin-opener`.
   - **Never** grant `allow-top-navigation`, or the dashboard could navigate the whole app away.
   - Internal `[[note]]` links → `openNote`.
7. **Keyboard:** keydown inside the iframe does not bubble to the host document. The shim listens for app shortcuts (Cmd/Ctrl+K, Cmd+P, Cmd+W, Esc, Cmd+[ ]) and relays `{method:"key", key, mods}`. The host re-dispatches them through its shortcut handler. Also handle focus: clicking the frame takes focus, and Esc returns focus to the host.

### 3.3 Platform notes
- **WKWebView (macOS):** custom schemes are first-class through `WKURLSchemeHandler`, which Tauri uses. Opaque-origin sandboxed frames work. Watch that `localStorage` inside an opaque-origin frame throws (SecurityError), so dashboards must not rely on it. Offer a `postMessage` `getState`/`setState` stored by the host if needed.
- **WebView2 (Windows):** the scheme becomes `http://baalda-view.localhost`. Make sure `frame-src` and the handler accept both forms. `srcdoc` sandboxing works the same as Chromium.
- Neither engine changes the CSP inheritance rule in 3.1. That rule is spec behaviour.

### 3.4 Three gotchas to remember
1. srcdoc and blob frames inherit the app's `script-src 'self'`, so the dashboard silently breaks only in packaged builds. Use the custom scheme with its own CSP.
2. Never combine `allow-scripts` with `allow-same-origin` on content served from an origin the app trusts. The frame could then remove its own sandbox and reach Tauri IPC.
3. `event.origin` is `"null"` for the sandboxed frame. Authenticate messages by `event.source`. Keyboard shortcuts and external links need explicit `postMessage` relays.

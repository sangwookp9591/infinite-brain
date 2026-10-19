<div align="center">

<img src="app/apps/desktop/src-tauri/icons/128x128@2x.png" alt="Infinite Brain app icon" width="96" height="96">

# Infinite Brain

**Your team's second brain, as plain Markdown files.**<br>
Write on your own computer, edit together in real time, and let your AI read and update the same notes.

[![CI](https://github.com/sangwookp9591/infinite-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/sangwookp9591/infinite-brain/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
![Platform: macOS | Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)

[Download](#-download) · [Getting started](#-getting-started) · [Working as a team](#-working-as-a-team) · [What your team sees](#-what-your-team-sees) · [AI](#-connect-your-ai) · [Self-hosting](#-run-your-own-server) · [Development](#-development)

<br>

<a href="docs/assets/promo/infinite-brain-promo.mp4"><img src="docs/assets/promo/poster.jpg" alt="Play the 40-second Infinite Brain intro video" width="900"></a>

<sub>▶ <a href="docs/assets/promo/infinite-brain-promo.mp4">Watch the 40-second intro</a></sub>

<br><br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/ui/main-dark.png">
  <img src="docs/assets/ui/main-light.png" alt="The Infinite Brain main window: an icon rail, a floating sidebar with the vault's notes, and a note open in the editor sheet" width="900">
</picture>

</div>

## Why Infinite Brain

- **Your notes are files.** Every note is a `.md` file in a normal folder. Open it in any editor, back it up any way you like, and keep it if you ever stop using the app.
- **Works offline.** You write locally first. Changes sync when you are back online, and edits from different people merge instead of overwriting each other.
- **Built for teams.** Invite people with a link, choose who can edit or only view each folder, and see who is in a note while you write.
- **AI that you can undo.** Connect Claude or ChatGPT to a vault. Every change an AI makes is recorded, shown as a diff and can be undone.

## 📦 Download

Get the latest version from [**Releases**](https://github.com/sangwookp9591/infinite-brain/releases/latest).

| System | File | Install |
|---|---|---|
| macOS 10.15+ (Apple Silicon and Intel) | `Infinite-Brain_<version>_universal.dmg` | Open the `.dmg` and drag **Infinite Brain** into Applications |
| Windows 10/11 | `Infinite-Brain_<version>_x64-setup.exe` | Run the installer. Windows may show SmartScreen the first time: **More info → Run anyway** |

The app keeps itself up to date: it installs new versions in the background, restarts at a quiet moment and shows what changed. You can also use **Check for updates** in the account menu.

## 🚀 Getting started

1. **Open the app and pick a vault.** A vault is a folder of notes. Create a new one, or open a folder of Markdown files you already have.
2. **Write.** Press **⌘N** (Ctrl+N on Windows) for a new note. Notes save automatically. Link notes with `[[Note name]]`; links and backlinks update when you rename a note.
3. **Find things.** Use search from the icon rail. It matches note titles and content, including Korean and other languages.
4. **See the shape of your notes.** The graph view draws your notes as a galaxy: each star is a note, and lines are links between notes.

Working alone needs no account and no server. Sign in only when you want to work with others.

<img src="docs/galaxy/macos-20000-dark-v2.png" alt="The galaxy graph view rendering 20,000 notes and their links as a spiral galaxy" width="100%">

## 👥 Working as a team

A team shares one **vault** on a server. Everyone keeps a full copy on their own computer, so it stays fast and works offline.

### 1. Create the team vault

Sign in (email and password, or Google if your server has it set up), then create a vault from the vault switcher at the top of the sidebar. If you already have a local vault, you can turn it into a team vault.

### 2. Invite people

Open **Invite people** from the vault menu. You can do it in either of two ways:

- **Invite link.** Enter email addresses and choose each person's role and access. If the server can send email, they get the link by email. If not, copy the link and send it yourself in chat. Opening the link takes them into the app, and they join after they sign in.
- **Join code.** Share the vault's join code. Teammates choose **Join with code** in the app. Codes expire, and an admin can create a new one at any time.

### 3. Decide who can see what

**Vault Settings → Members and access** controls access in plain words:

| Setting | What it means |
|---|---|
| **Everyone in the vault** | Can edit / Can view / No access, for every member by default |
| **New members** | What people who join later get for notes made before they joined |
| **Each person** | Can edit everything / Can view everything / No access / Custom (folder by folder) |

You can also share a single folder or note from **Share…** in the sidebar, or lock a note so it cannot be edited. Roles are **Owner**, **Admin** and **Member**. **Guests** see only the folders shared with them by name, and none of the rest of the vault. Admins can turn external sharing off and revoke all guest access in one step.

### 4. Share a note

From a note's share button:

- **Team link** opens the note for people in the vault who have access.
- **Publish to the web** gives a link anyone can read in a browser. Turn it off and the link stops working.

## 👀 What your team sees

<picture>
  <img src="docs/assets/ui/home-light.png" alt="A vault Home dashboard with today's priorities and a schedule, next to the sidebar" width="900">
</picture>

| When… | You see |
|---|---|
| Someone is in the same note | Their avatar at the top of the note, and their cursor and selection moving in the text as they type |
| Someone edits a note you have open | The text changes in place, live. You don't need to reload and nothing gets overwritten |
| Someone edits a note's properties while you are typing | "Changed by someone else while you were typing." under that property |
| Your changes are saved | **Synced · just now** at the top right, and a green dot beside each note in the sidebar |
| You are offline | Your edits are kept on your computer and sent when you reconnect |
| Notes are added, deleted or moved, or your access changes | A line in the **Activity** panel saying what happened, where, and when |
| You want an earlier version | **Version history** on the note. Pick a version and choose **Restore version**, which puts it back for everyone |
| You want someone's attention | **Ping** them from their avatar. They get a notification |
| An AI changed a note | An entry in **Activity → AI changes** with a before/after diff and an Undo button |

Deleted notes go to the system Trash on each computer instead of disappearing, and the app keeps recovery copies when a sync could lose text.

## 🤖 Connect your AI

Open the AI section of **Vault Settings** and follow the wizard to connect Claude or ChatGPT over MCP. Choose what it may do:

- **Read only**: search and read notes
- **Read and write**: also create and edit notes
- **Read, write and delete**

Every AI edit is listed in **Activity → AI changes** with a diff. **Undo** restores the earlier text. If a person has edited the note since then, Undo stops instead of overwriting their work. You can see and disconnect every connection at any time.

AI tools on your own computer (Claude Code, Codex and others) can also edit the Markdown files directly. Their edits show up in the app and sync to your team like any other change.

## 🖥 Run your own server

Your team's notes sync through a server you control. You can run it with Docker Compose on any machine, or on Railway or Coolify.

```sh
cd deploy/compose
cp .env.example .env      # set POSTGRES_PASSWORD, JWT_SECRET and BETTER_AUTH_URL
docker compose up -d
```

Then, in the app, choose **your own server** when you sign in (or go to **Settings → Connection**) and enter its URL. Send teammates `https://<your server>/open/connect` and the app connects to the server on its own.

The full guide, covering HTTPS, email, file storage and backups, is in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## 🧠 How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bridge-dark.svg">
  <img src="docs/assets/bridge-light.svg" alt="Markdown on disk and a live Yjs CRDT kept in sync by a two-way bridge" width="900">
</picture>

- **Markdown on disk is the durable copy.** The desktop app (Rust) writes files atomically and watches for edits made by other programs.
- **A CRDT is the live copy.** Each open note is a Yjs document. Edits from people and AI tools merge without conflicts, and the bridge writes the result back to the file.
- **Stable identity.** Every note has a `doc_id` that survives renames and moves, so links, history and sharing follow the note.
- **The server stores what teams share.** It runs Hono, Hocuspocus and Postgres. It checks permissions on every request and sync connection, so the server enforces access, not the app.

| Part | Path | Stack |
|---|---|---|
| Desktop app | [`app/apps/desktop/`](app/apps/desktop/) | Tauri 2, Rust, React 19, CodeMirror 6, Yjs, SQLite |
| Server | [`app/apps/server/`](app/apps/server/) | Node 22, Hono, Hocuspocus, Better Auth, Postgres, MCP |

More detail is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/specs/`](docs/specs/).

## 🛠 Development

Requirements: Node.js 22 or newer, pnpm (via Corepack), Rust, and Docker for Postgres.

```sh
cd app
pnpm install

# Server on http://localhost:3010
cd apps/server
cp .env.example .env        # set a random JWT_SECRET
pnpm run db:up              # Postgres on port 5439
pnpm run migrate
pnpm run dev

# Desktop app, in another terminal from app/
pnpm run dev:desktop
```

| Check | Where | Command |
|---|---|---|
| Server tests (they wipe the configured database, so use a disposable one) | `app/apps/server` | `pnpm test` |
| Desktop tests | `app/apps/desktop` | `pnpm test` (on Node 25: `NODE_OPTIONS=--no-experimental-webstorage`) |
| Rust tests | `app/apps/desktop/src-tauri` | `cargo test` |
| Lint | `app` | `pnpm lint` |

**Installers.** Pushing a version bump to `main` runs [`release.yml`](.github/workflows/release.yml), which builds the `.dmg` (Apple Silicon and Intel), Windows `.exe`/`.msi` and Linux packages and publishes them to GitHub Releases. See [`docs/RELEASE.md`](docs/RELEASE.md) for the signing secrets. To build a local macOS app without the updater key:

```sh
cd app/apps/desktop
pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Developer notes and the rules that keep data safe are in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md). Build status is in [`docs/STATUS.md`](docs/STATUS.md).

## 🤝 Community

[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)

## 📄 License

[Apache License 2.0](LICENSE). See [`NOTICE`](NOTICE) for attributions. The design kit's interactions are adapted from [React Bits](https://reactbits.dev) under the MIT + Commons Clause license; see [`app/apps/desktop/src/components/kit/LICENSE-react-bits.md`](app/apps/desktop/src/components/kit/LICENSE-react-bits.md).

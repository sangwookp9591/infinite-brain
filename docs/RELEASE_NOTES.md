<!--
  User-facing release notes. This file IS the GitHub release body and the in-app
  "What's New" modal, so write it for the person who just got the update.

  The rule, and the release workflow depends on it:

  - One `## <version>` section per release, newest first, matching the version in
    `app/apps/desktop/src-tauri/tauri.conf.json`.
  - 2–5 points per section. Combine related changes into themes ("Sync light:
    …", "Health page: …", "Editor: …") — never one bullet per commit.
  - One or two sentences per point, ~200 characters at most. Plain language, no
    file names, no issue numbers.
  - Start each point with a short label and a colon: `Sync light: It now shows your
    whole vault.` Write what follows the colon as a sentence of its own: the card
    shows it separately from the label. The part before the first ": " (2–28 characters, no sentence
    punctuation) becomes the row label in the What's New card; the rest is the
    change. A point without a label still shows, under "New". Labels starting
    with Changed / Note / Heads-up / Deprecated / Removed / Moved get a neutral
    gray mark instead of the green arrow.
  - `.github/workflows/release.yml` ships ONLY the section whose heading matches
    the version being released (never another version's), and strips
    this comment. Old sections are history, not release copy — they must never
    reappear under a new version.
  - Every staging PR adds or edits ONLY the section for the version it will ship
    in. If that section does not exist yet, create it at the top.
  - SILENT IS THE DEFAULT. A release shows What's New only when its own
    `## <version>` section has points; no section or an empty one ships silently
    (every app still installs it). Ask before each release: silent, or notes?
-->

## 0.2.1

- Korean: The sidebar, menus, sign-in, sharing and the sync status now speak Korean. Pick English or 한국어 in Settings → Appearance, or leave it on System.
- Smart search: Turn it on in Vault settings to find notes by meaning, not just words. It downloads a 310 MB model once and runs on your Mac, so your notes never leave it.
- A star, once: After about five days of use, a small card asks whether you'd like to star Infinite Brain on GitHub. It appears once and never blocks a note.
- Update card: When the app updates itself, each change now appears as its own row in a card.
- Feature help: A ? beside Smart search, Members and access, AI connections and Versioning says what each does, where it applies and how your team uses it.

## 0.2.0

- Notes as files: Your notes are plain Markdown files on your own computer, and your team edits them together in real time.
- Teams: Invite people with a link or a join code, choose who can edit or only view each folder, and see who is in a note as they type.
- AI you can undo: Connect Claude or ChatGPT to a vault, see every AI change as a diff and undo it.
- Galaxy view: Explore your notes as a galaxy, and take a short tour the first time you open the app.
- Languages: The app now speaks English and Korean. Pick one in Settings → Appearance.

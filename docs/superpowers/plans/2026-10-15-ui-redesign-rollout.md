# UI Redesign Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repository the coordinator dispatches each task to an Orca worker and verifies it independently.

**Goal:** Apply the new visual language (zinc surfaces, ink accent with user customisation, React Bits–style kit) to the whole desktop app.

**Architecture:** P1 adds an `accent` appearance key (desktop + server) whose seed is turned into per-theme accent tokens by a pure OKLCH function with a contrast guard; CSS derives the rest. P2 folds `tokens-next.css` into `tokens.css` so every existing `var(--…)` consumer reskins at once, then restyles shared primitives. P3–P7 restyle each area, swap in kit components where spec §6.4 says, and remove hardcoded colours.

**Tech Stack:** React 19, TypeScript, plain CSS custom properties, `motion` v12, Vitest (node env), Hono server (appearance schema), Tauri 2 webview.

**Spec:** `docs/superpowers/specs/2026-10-15-ui-redesign-color-design.md` (§3 P1 detail, §6 new visual language). Read both.

## Global Constraints

- Colours, radii and shadows come only from `app/apps/desktop/src/styles/tokens.css` variables; no new hex/rgb literals outside tokens.css except documented data palettes (`lib/appearance.ts ITEM_COLORS`, dashboard templates, presence colours, graph palette).
- Default accent is **ink**: light `#18181b` / on-accent `#fafafa`; dark `#f5f5f5` / on-accent `#18181b` (spec §6.2).
- Light-first: `:root` is light, `[data-theme="dark"]` is dark, and the `prefers-color-scheme` fallback block must define the same variable names as the dark block.
- Springs only from `src/components/kit/motion.ts` (`SNAPPY`, `SOFT`, `useSpring`); `prefers-reduced-motion` turns decorative motion off.
- No new runtime dependencies. Display font stays Radio Canada Big until the user answers spec Q9.
- Do not change component behaviour, props or IPC except where a task swaps in a kit component; never weaken deletion/revocation/recovery guards (CLAUDE.md). FuseButton/swipe-delete only on reversible actions (trash, archive, AI-change undo).
- Authorization unchanged: server keeps owner/admin check on vault appearance; UI state never authorizes.
- Preserve HTML sanitization and the packaged-app CSP; the `index.html` inline script stays the only inline script.
- New source files: Apache-2.0 SPDX header (kit files keep their React Bits notice). No commits or pushes unless the user asks.
- Verification per task (from `app/apps/desktop`): `pnpm lint` 0 errors, `npx tsc --noEmit -p .`, `NODE_OPTIONS=--no-experimental-webstorage npx vitest run <touched test dirs>`; server tasks: `npx tsc --noEmit -p .` in `app/apps/server` plus the appearance schema unit test (no DB-wiping suites). UI tasks: real Chrome screenshots of the window simulator (`pnpm exec vite --mode simulator`, `/dev/window-simulator/?platform=macos&theme=light|dark`) at 1280px, inspected.

## Review Focus

- A stored accent from an older client or a hand-edited row (`"#FFF"`, `"red"`, `"#ffffff "`) must be ignored on both sides, not crash or paint garbage — Task 1 tests.
- Near-white or near-yellow custom accents must still yield readable button text in both themes (≥4.5:1) — Task 2 tests.
- Cold start with a custom accent and dark theme must not flash violet/ink-light for a frame — Task 3 manual check + script unit test of the cache validator.
- Switching theme while a custom accent is set must swap to that accent's dark/light pair without re-running JS — Task 3 CSS selector order, checked in simulator.
- Dark block vs fallback block drift (a variable defined in one but not the other turns text black in one OS mode) — Task 4 sync test.

## Execution order

Task 3's CSS blocks sit on Task 4's tokens, and Tasks 3 and 5 both edit `AppearanceRows.tsx`, so: **W1** Tasks 1, 2, 4 in parallel → **W2** Task 3 → **W3** Tasks 5 and 10 → **W4** Tasks 6–9 in parallel (each edits only its own App.css line ranges and re-reads the file before every edit) → **W5** Task 11.

---

### Task 1: `accent` appearance key (desktop + server contract)

**Files:**
- Modify: `app/apps/desktop/src/lib/appearanceSettings.ts` (types, `APPEARANCE_KEYS`, `APPEARANCE_DEFAULTS`, `validAppearanceValue`)
- Modify: `app/apps/server/src/appearance/schema.ts` (`VaultAppearance`, `CHECKS`)
- Test: `app/apps/desktop/src/lib/__tests__/appearanceSettings.test.ts`, server `app/apps/server/src/appearance/schema.test.ts`

**Interfaces:**
- Produces: `type AccentSetting = "ink" | \`#${string}\``; `AppearanceSettings.accent?: AccentSetting`; `APPEARANCE_DEFAULTS.accent = "ink"`; `validAppearanceValue("accent", v)` returns `"ink"` or a lowercase `#rrggbb`, else `undefined`. Server `CHECKS.accent = (v) => v === "ink" || (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v))`.

- [ ] **Step 1: failing desktop tests** — table: `"ink"→"ink"`, `"#3B74D1"→"#3b74d1"`, `"#fff"`, `"red"`, `"#ffffff "`, `"#gggggg"`, `null`, `3` → `undefined`; `parseAppearanceSettings({accent:"#ABCDEF"}).accent === "#abcdef"`; `effectiveAppearance({}, {accent:"#123456"}).accent === "#123456"`; `effectiveAppearance({accent:"ink"}, {accent:"#123456"}).accent === "ink"`.
- [ ] **Step 2: failing server tests** — same accept/reject table through the schema's parse function; unknown keys still refused.
- [ ] **Step 3: implement** both sides exactly as the Interfaces block says; add `"accent"` as the 7th entry of `APPEARANCE_KEYS`.
- [ ] **Step 4: run** desktop vitest for the file and server unit test for the schema; both pass. Run desktop and server `tsc`.

### Task 2: `accentPalette` — OKLCH derivation with contrast guard

**Files:**
- Create: `app/apps/desktop/src/lib/accent.ts`
- Test: `app/apps/desktop/src/lib/__tests__/accent.test.ts`

**Interfaces:**
- Produces: `contrast(a: string, b: string): number` (WCAG, `#rrggbb` inputs); `accentPalette(seed: string): { light: Pair; dark: Pair }` with `type Pair = { accent: string; hover: string; onAccent: string }`, all `#rrggbb`. Surfaces: light `#ffffff`, dark `#18181b`. On-accent candidates `#ffffff` and `#18181b`.

- [ ] **Step 1: failing tests** — for presets (`#3b74d1 #3f8850 #dc6e52 #7f73ff`), extremes (`#ffffff #000000 #ffff00 #777777`) and 200 seeded-random seeds: in both themes `contrast(onAccent, accent) >= 4.5` and `contrast(accent, surface) >= 3`; outputs match `/^#[0-9a-f]{6}$/`; `hover !== accent`; deterministic for the same seed.
- [ ] **Step 2: implement** per spec §3.5 (sRGB↔OKLab/OKLCH ~30 lines, start L light `min(L,0.90)` stepping −0.01, dark `max(L,0.76)` stepping +0.01, max 100 steps, gamut-map by reducing chroma; hover ±0.06 L; onAccent white if ≥4.5 else `#18181b`).
- [ ] **Step 3: run** the test; passes.

### Task 3: Apply accent at runtime, first paint, Accent row

**Files:**
- Modify: `app/apps/desktop/src/lib/theme.ts` (add `applyAccent`), `app/apps/desktop/src/store.ts` (`applyAppearance` calls it and writes the paint cache), `app/apps/desktop/index.html` (inline script), `app/apps/desktop/src/styles/tokens.css` (custom blocks after Task 4's tokens), `app/apps/desktop/src/components/AppearanceRows.tsx` (Accent row)
- Create: `app/apps/desktop/src/lib/paintCache.ts` (pure validator shared by tests; the inline script duplicates its 2 regexes only)
- Test: `app/apps/desktop/src/lib/__tests__/paintCache.test.ts`

**Interfaces:**
- Consumes: `accentPalette` (Task 2), `AccentSetting` (Task 1), ink tokens (Task 4).
- Produces: `applyAccent(setting: AccentSetting): void` — `"ink"` removes `data-accent` and the six `--accent-custom-*`/`--on-accent-custom-*` properties; a hex sets them from `accentPalette` and stamps `data-accent="custom"`. `PAINT_CACHE_KEY = "context.appearancePaint.v1"`; `readPaintCache(raw: string | null): { theme: ThemeMode; accentVars: Record<string,string> | null } | null` rejecting any key not matching `/^--(on-)?accent-custom-(light|dark)(-hover)?$/` or value not `/^#[0-9a-f]{6}$/`.

- [ ] **Step 1: failing tests** for `readPaintCache`: valid object round-trips; bad JSON, wrong key, `url(...)` value, missing theme → `null`/accent dropped.
- [ ] **Step 2: tokens.css custom blocks** exactly as spec §3.4, in order light-custom → dark → dark-custom → fallback-custom, with the order comment. Ink default path untouched.
- [ ] **Step 3: implement** `applyAccent`, cache write in `applyAppearance` (effective theme + vars), inline script reading the cache first and `cbk-theme` as fallback, validating with the same two regexes.
- [ ] **Step 4: Accent row** in `AppearanceRows` under Theme: swatches Ink, Blue `#3b74d1`, Teal `#23877e`, Green `#3f8850`, Amber `#c98a12`, Coral `#dc6e52`, Rose `#d4567a`, Violet `#7f73ff`, plus Custom (`<input type="color">` + `#rrggbb` text field). Personal mode shows the existing `trailing("accent")`; vault mode respects `readOnly`. Hint "Adjusted for readability" when `accentPalette(seed).light.accent !== seed`.
- [ ] **Step 5: verify** tests + simulator: set Blue, toggle light/dark, reload (no flash), set Ink. Check GraphView still reads `--accent` as a hex.

### Task 4: Fold the new tokens into tokens.css (P2a)

**Files:**
- Modify: `app/apps/desktop/src/styles/tokens.css` (light `:root`, `[data-theme="dark"]`, fallback block), `app/apps/desktop/src/components/graph.css` (5 accent literals → `color-mix(in srgb, var(--accent) N%, transparent)`)
- Delete: `app/apps/desktop/src/styles/tokens-next.css` and its import in `dev/design-lab/preview.tsx`
- Create: `app/apps/desktop/src/styles/__tests__/tokensSync.test.ts`
- Modify: `app/apps/desktop/src/styles/DESIGN-BRIEF.md` (rewrite for the new language: spec §6.2–6.4 summary, hard rules 1,2,4 kept, rule 3 replaced by "use kit components where §6.4 lists them")

**Interfaces:**
- Produces: every token in `tokens-next.css` (including new `--bg-raised`, `--radius-input/row/card/slot`, `--display-tracking`, `--warning`, `--warning-soft`) defined in all three blocks of tokens.css.

- [ ] **Step 1: failing sync test** — parse tokens.css text; the set of `--names` in `[data-theme="dark"]{…}` equals the set in the fallback block; every name used via `var(--x)` in `src/components/kit/*.css` is defined in `:root`.
- [ ] **Step 2: merge** values from tokens-next.css into the three blocks (fallback = dark values), keep non-colour tokens, keep `--brand-*` fixed identity colours. Remove the file and the lab import; lab must look identical.
- [ ] **Step 3: run** sync test, lint, tsc; screenshot simulator light/dark and the design lab.

### Task 5: Shared primitives (P2b)

**Files:** `app/apps/desktop/src/App.css` lines ~1–216 (buttons, inputs, scrollbars), 2290–2420 (range slider), 7030–7156 (spinner, success tick, AsyncButton), 7609–7796 (banners, toasts, press feedback, row ⋯ menu); `components/Switch.tsx`, `components/MenuSelect.tsx`, `components/ThemeToggle.tsx`, `components/AppearanceRows.tsx`, `components/ContentWidthPreview.tsx`.

**Interfaces:**
- Consumes: kit `SegmentedChips`, `BarSlider`, `SpringCheck` (read their props in `src/components/kit/*.tsx`).

- [ ] **Step 1:** restyle primary/secondary/ghost buttons (pill, ink fill, `--text-on-accent`), inputs (`--radius-input`, `--bg-subtle`, focus `--focus-ring`), switch (ink track when on), menus/popovers (`--radius-card`, `--shadow-lg`), toasts/banners (surface + hairline, status colours only as a 6px dot or icon), spinner (ink).
- [ ] **Step 2:** `AppearanceRows`: Theme → `SegmentedChips` (both modes; vault mode honours `readOnly` via `disabled`), Content width & Text size → `BarSlider` keeping `measureToSlider/sliderToMeasure` and min/max/step; Properties → `SegmentedChips`. `ThemeToggle` elsewhere keeps working.
- [ ] **Step 3:** run `src/__tests__` tests touching AppearanceRows/prefs, lint, tsc, simulator screenshots of Account Settings → Appearance in both themes.

### Task 6: Shell, sidebar, navigation, welcome (P3)

**Files:** `App.css` 217–717 (welcome/vault picker), 718–2420 (drag regions, sidebar, rail, search, file tree, context/sort menus, role picker), 2793–2949 (tabs), 3641–4313 (identity, account menu, vault switcher); `components/VaultPicker.tsx`, `FileTree.tsx`, `SearchPanel.tsx`, `TabBar.tsx`, `VaultSwitcher.tsx`, `SidebarHeader.tsx`, sync status component (find where sync progress is shown: grep `SyncProgress`/`syncProgress`); `HomeNavigation.css`, `talk.css`.

- [ ] **Step 1:** restyle sidebar to the lab "Sidebar" scene: `--bg-app` sidebar, rows `--radius-row` with `--bg-hover`, selected row ink-soft (`--bg-active`) not accent text, search field `--radius-input`.
- [ ] **Step 2:** VaultPicker: recent vaults as `FolderCard` grid, join code input → `CodeSlots` (same validation/submit), keep every existing flow and error path.
- [ ] **Step 3:** sync status line → `ActivityLattice` (working/done/error mapped from existing state; keep text); bulk sync progress → `ProgressDial` read-only where a percentage exists.
- [ ] **Step 4:** remove the 20 hardcoded colours in these ranges (grep `#[0-9a-fA-F]{3,8}|rgba?\(` in the listed ranges/files) or document data-palette exceptions inline.
- [ ] **Step 5:** tests for touched components (`src/components/__tests__`), lint, tsc, simulator screenshots (welcome screen, main window, file tree context menu) both themes.

### Task 7: Editor, viewers, panels (P4)

**Files:** `App.css` 2421–2792, 2950–3640, 5662–5702, 7797–8154; `components/editor.css`, `compare.css`, `aiChanges.css`; `lib/editor/theme.ts`; `components/AiChanges*.tsx`, `RightPanel.tsx`, `VersionPanel.tsx`.

- [ ] **Step 1:** editor sheet on `--bg-surface`, headings `letter-spacing: var(--display-tracking)`, code blocks `--bg-subtle` + `--radius-input`, callouts keep `--callout-tint`.
- [ ] **Step 2:** Markdown task checkboxes: CSS-only spring-check look (box `--border-strong` → ink fill, tick draw via `stroke-dashoffset` transition, label strike) in the CM6 widget class; no React in CM6.
- [ ] **Step 3:** AI change "Undo" → `FuseButton` where the existing flow already allows undo (409 refusal path unchanged); Trash on a note from the editor header → `FuseButton` (moves to trash; undo restores via existing restore).
- [ ] **Step 4:** remove 16 hardcoded colours; tests in `lib/editor/__tests__`/`*.test.ts` touched, lint, tsc, screenshots (note with tasks, code, callout; version panel; AI changes).

### Task 8: Dialogs, settings, members, billing (P5)

**Files:** `App.css` 4314–5661, 5703–6140, 6171–7030, 7157–7608, 8155–10820; `components/SettingsModal.tsx`, `AccountSettings.tsx`, `VaultSettingsDialog.tsx`, `AuthDialog.tsx`, `Members*.tsx`, `ShareDialog.tsx`, `InvitePeopleDialog.tsx`, `ConfirmDialog.tsx`, `UpgradeDialog.tsx`, `Plan*.tsx`, `BugReportDialog.tsx`.

- [ ] **Step 1:** modal shell: `--radius-card`, `--shadow-lg`, backdrop `rgb(0 0 0 / .32)` light / `.6` dark via tokens, header display tracking; settings nav as quiet list with ink-soft selection.
- [ ] **Step 2:** member/share rows use the SwipeRow look (hover drawer) only for reversible actions; role pickers stay menus; irreversible actions keep `ConfirmDialog`.
- [ ] **Step 3:** email verification / any one-time code entry → `CodeSlots` if present; checkboxes → `SpringCheck`.
- [ ] **Step 4:** remove 16 hardcoded colours; tests for touched components, lint, tsc, screenshots (Account Settings tabs, Vault Settings → Members, Share dialog, Auth dialog).

### Task 9: Dashboards, Health, Home (P6)

**Files:** `components/health.css`, `HomeDashboardDialog.css`, `housekeeper.css`, `DashboardAgentRunner.css`, `styles/dashboard.css`, `DashboardTemplateGallery.css`, `VaultDashboardsTab.css`; `components/Health*.tsx`, `DashboardTemplateGallery.tsx`, `DashboardAgentRunner.tsx`, `HousekeeperPanel.tsx`.

- [ ] **Step 1:** template gallery cards → `GlowCard`; agent runner status → `ActivityLattice`; health score rings → `ProgressDial` read-only.
- [ ] **Step 2:** remove or document the 28 hardcoded colours (template TS colours are user content → documented exception).
- [ ] **Step 3:** tests, lint, tsc, screenshots (Vault Settings → Dashboards, Health tab, home dashboard).

### Task 10: Graph tokens (P7)

**Files:** `components/graph.css`, `components/GraphControls.tsx`.

- [ ] **Step 1:** move the remaining graph literals into a `.graph-view { --graph-* }` token block at the top of graph.css (always-dark space stays); graph controls panel uses kit `BarSlider`/`SegmentedChips` styling via the same tokens.
- [ ] **Step 2:** galaxy lab screenshots before/after identical in space colours; lint, tsc.

### Task 11: Final verification

- [ ] Full desktop vitest (`NODE_OPTIONS=--no-experimental-webstorage pnpm test`), lint, tsc, server tsc + schema test.
- [ ] Simulator screenshot sweep: welcome, main window, settings (all tabs), dialogs, graph, in light and dark, Ink and Blue accent, 1280px and 900px.
- [ ] grep check: hardcoded colours outside tokens.css match the documented exception list.
- [ ] Update `docs/STATUS.md` top section and `README.md` screenshots if the main window changed.

# Infinite Brain — Orbit Design Brief

The visual language is **Orbit** (`docs/superpowers/specs/2026-10-17-identity-redesign-directions.md`
§6–§7; mock-ups in `dev/design-lab/directions/`): calm, floating islands in a
night sky. `tokens.css` is the single token source; the accent customisation
contract (personal ?? vault ?? default, derived tokens, contrast tests) is
unchanged and Orbit violet is the new default.

## The look

- Indigo-tinted neutrals: `--bg-app` canvas, `--bg-subtle` islands (rail,
  sidebar, panels), `--bg-surface` sheets and cards, `--bg-raised` interaction
  layers. Dark and system modes mirror the same scale; the pre-hydration
  fallback block repeats the explicit dark tokens.
- One accent (`--accent`, violet `#4a3fd4` / `#a29bff`) with `--accent-soft` for
  selected rows and tabs. `--accent-default` is the fixed default for swatches.
  Selected text is pulled toward `--text-primary` so any custom accent stays >= 4.5:1.
- Shell: icon rail (`--rail-w`) + floating sidebar island + a header on the
  canvas (breadcrumb, open-file tabs, controls) above the floating editor sheet
  (`.editor-wrap`, `--radius-sheet`).
- Radii: pills for actions and chips, `--radius-input` inputs, `--radius-lg`
  rows, `--radius-island` islands and cards, `--radius-inner` nested panels,
  `--radius-sheet` sheets. Keep the `--sp-*` 4pt spacing grid.
- Shadows are soft and violet-tinted in light and hairline + depth in dark;
  consume `--shadow-*` instead of inventing shadows.
- Type: Geist for UI, Pretendard for Hangul, Fraunces for English display
  headings (`--font-display`, `--display-tracking`), Geist Mono for code and
  numerals. All bundled locally (OFL; see `assets/fonts/`).
- Icons: 1.5px round-cap lines (`--icon-stroke`, `components/icons/OrbitIcon`);
  avatars are the generated Neuron marks, vault icons the generated vault marks
  (`lib/avatar/`).

## Motion and component language

Use `SNAPPY` (520/34) and `SOFT` (260/26) from `components/kit/motion.ts`.
Animate transform and opacity; use Motion layout for layout movement.
Reduced motion disables decorative movement and resolves springs immediately,
with any opacity transition no longer than 120ms. Preserve keyboard operation
and native-equivalent ARIA semantics.

Use kit components at the spec §6.4 locations:

| Kit component | App surfaces |
| --- | --- |
| SegmentedChips | Theme, property mode, graph scope, sorting |
| BarSlider | Content width, text size, graph forces |
| ProgressDial | Sync, upload, reindex progress |
| CodeSlots | Vault join codes, email verification |
| ActivityLattice | AI agent status, sync status, dashboard runner |
| SpringCheck | Settings checkboxes; CSS equivalent for CM6 task widgets |
| FuseButton | Reversible note trash/archive and AI-change undo |
| SwipeRow | Tree, search, AI-change and member rows; hover action drawer |
| GlowCard | Dashboard templates, vault cards, major dialogs |
| FolderCard | Empty folders |

Fuse and swipe deletion apply only to reversible operations. Permanent deletion,
permission revocation and vault deletion retain confirmation and existing guards.
Preserve props, behaviour and IPC outside explicitly planned kit substitutions.

## Voice

Calm, clear and spacious: hierarchy comes from surfaces, typography and motion.

## Hard rules

1. Every color/spacing/radius/shadow comes from `tokens.css` variables. No hardcoded values.
2. Both themes must look intentional — check every surface in light AND dark.
3. Use kit components where spec §6.4 lists them; preserve behaviour and safety guards.
4. All existing tests and builds must stay green.

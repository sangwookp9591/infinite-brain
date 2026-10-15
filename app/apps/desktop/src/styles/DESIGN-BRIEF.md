# Infinite Brain — Zinc / Ink Design Brief

The visual language follows the approved colour design spec, §6.2–6.4:
`docs/superpowers/specs/2026-10-15-ui-redesign-color-design.md`.
The design lab and app share `tokens.css` as their single token source.

## The look

- Light-first zinc surfaces: `--bg-app` canvas, `--bg-surface` cards and editor
  sheets, `--bg-subtle` inputs, `--bg-raised` elevated interaction layers.
  Dark and system modes use the same language; the pre-hydration fallback
  mirrors the explicit dark tokens.
- Ink is the default accent: near-black in light, near-white in dark, with
  `--text-on-accent` for filled controls. Custom accents replace the accent tier;
  fixed `--brand-*` identity colours remain independent.
- Selection uses surface inversion and motion. Rows use `--bg-active` with
  `--text-primary`; reserve semantic colours for status dots and icons.
- Use surface contrast and necessary hairlines, restrained light shadows and
  dark elevation tokens. Consume `--shadow-*` instead of inventing shadows.
- Buttons and chips use `--radius-pill`; inputs `--radius-input` (12px), rows
  `--radius-row` (16px), cards `--radius-card` (20px), code slots
  `--radius-slot` (14px). Keep the `--sp-*` 4pt spacing grid.
- Body: Open Sauce Two. Display: Radio Canada Big until the display-font decision;
  large headings use `--display-tracking` (-0.03em). Numbers, times and code use
  `--font-mono` and tabular numerals. Fonts remain available offline.

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
| FolderCard | Vault picker, empty folders |

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

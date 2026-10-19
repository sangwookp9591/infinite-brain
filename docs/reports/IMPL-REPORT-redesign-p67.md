# P6 + P7 Orbit redesign report

Date: 2026-10-17  
Branch: `sangwookpark/ib-redesign-p67`  
Base: `551f2a7`

## Changes

- Audited `graph.css`: it has 24 explicit color declarations before and after this completion pass. All 24 are grouped in the scoped `.graph-view` graph-only token block; there are no color literals elsewhere in the stylesheet. The block keeps the graph in a dark sky for both app themes. The previous branch commit `ebc8f57` aligned the GPU renderer background, links and rays with those tokens.
- Added simulator-only direct routes: `surface=home`, `surface=dashboard-dialog`, `surface=dashboard-manage`, `surface=health`, and `surface=housekeeper`. Health and Housekeeper use labeled synthetic fixtures; Housekeeper status and diagnosis calls are replaced in memory. Route details are in `app/apps/desktop/dev/window-simulator/README.md`.
- Reviewed light/dark and narrow screenshots. The dashboard template’s colors are part of the opaque user-content preview, so they intentionally retain their own palette. Health, Housekeeper, dashboard dialog, and graph chrome already match Orbit radius, card, spacing, and typography tokens; no additional production CSS changes were needed.
- P6 target CSS has 0 hardcoded color literals. No new token promotion candidates were identified.

## Color counts

Command: `rg -c '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' app/apps/desktop/src/components/graph.css`

- `graph.css`: 24 before → 24 after; 24 are scoped token declarations and 0 are outside the graph token block. These are the graph’s fixed dark-space, fixed-on-dark text, and luminous renderer colors, so they stay independent of app theme.
- P6 target CSS (`health.css`, `HomeDashboardDialog.css`, `housekeeper.css`, `DashboardAgentRunner.css`, `styles/dashboard.css`, `DashboardTemplateGallery.css`): 0 color literals.
- Graph note/folder and plasma categorical palettes in `lib/graph/graphColor.ts`, and the template palettes in `lib/dashboard/{templates,deployedTemplates,importedTemplates}.ts`, remain intentional data/user-content colors rather than interface chrome.

## Preview screenshots

Saved under `/private/tmp/ib-redesign/p67/`. The simulator page and graph harness use synthetic data. Health, Home, Home dashboard setup, and Housekeeper were captured in Windows simulator mode at both sizes and themes:

- Health: `health-light-1440x900.png`, `health-dark-1440x900.png`, `health-light-720x600.png`, `health-dark-720x600.png`.
- Home dashboard: `home-light-1440x900.png`, `home-dark-1440x900.png`, `home-light-720x600.png`, `home-dark-720x600.png`.
- Home dashboard setup dialog: `dashboard-dialog-light-1440x900.png`, `dashboard-dialog-dark-1440x900.png`, `dashboard-dialog-light-720x600.png`, `dashboard-dialog-dark-720x600.png`.
- Housekeeper: `housekeeper-light-1440x900.png`, `housekeeper-dark-1440x900.png`, `housekeeper-light-720x600.png`, `housekeeper-dark-720x600.png`.
- Graph from the prior P7 capture: `graph-light-1440x900.png`, `graph-dark-1440x900.png`, `graph-light-720x600.png`, `graph-dark-720x600.png`.
- MacOS simulator spot checks at 1440×900 dark: `home-macos-dark-1440x900.png`, `dashboard-dialog-macos-dark-1440x900.png`.

Graph screenshots were taken with GPU disabled in headless Chrome, so they show the existing 2D fallback rather than WebGPU/WebGL. The macOS spot checks are browser simulations; no native Windows WebView2 or macOS window behavior was tested.

## Verification

- `pnpm install --frozen-lockfile` from `app/`: passed in the preceding task; no dependency or lockfile changes in this pass.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=2 src/lib/graph src/components/__tests__/healthView.test.ts src/components/__tests__/healthPlaceGroups.test.ts src/components/__tests__/housekeeperPanel.test.ts src/components/__tests__/homeDashboardDialog.test.ts src/components/__tests__/dashboardTemplateGallery.test.ts src/components/__tests__/dashboardAgentRunner.test.ts` from `app/apps/desktop/`: 11 files, 136 tests passed.
- `pnpm exec tsc --noEmit` from `app/apps/desktop/`: passed.
- `pnpm exec eslint dev/window-simulator/preview.ts dev/window-simulator/surfacePreview.tsx` from `app/apps/desktop/`: 0 errors; 4 existing `no-explicit-any` warnings in `preview.ts` (`fixtureIpc` callback and the two existing `window as any` assignments).
- `pnpm run simulate:windows` from `app/apps/desktop/`: Vite simulator started successfully on port 1425; direct surface routes rendered and screenshots were saved.
- No packaged application build was run.

## Remaining work

- None for this visual review pass. Native platform window behavior and GPU-backed graph captures remain unverified.

## Commits

- `ebc8f57 feat(desktop): align graph renderer with Orbit palette` (prior branch step: graph renderer/token alignment).
- `094713d feat(desktop): add P6 simulator preview routes`.
- `docs: update P6/P7 implementation report` (this commit).

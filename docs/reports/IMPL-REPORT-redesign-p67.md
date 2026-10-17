# P6 + P7 Orbit redesign report

Date: 2026-10-17  
Branch: `sangwookpark/ib-redesign-p67`  
Base: `551f2a7`

## Changes

- Reviewed the P6 Health, dashboard, HomeDashboardDialog, housekeeper, and dashboard agent/gallery styles. They already consume Orbit semantic color and radius tokens; the scoped P6 CSS files contain no hardcoded color literals, so no visual behavior changes were needed there.
- Consolidated the remaining graph renderer edge/ray colors into the graph-only token block in `graph.css`, then read those values in `GalaxyRenderer`. The opaque 3D scene now uses the same graph-space core token as the CSS starfield, preventing a different navy clear color between renderers. The graph overlay uses the Orbit island radius and stays dark regardless of the app theme.
- No changes to graph layout/simulation, including the sparse-vault `galaxyLayout` path.

## Hardcoded color grep

Command scope: P6 target CSS, `graph.css`, and non-test files under `lib/graph`, matching hex, rgb/rgba, and hsl/hsla syntax.

- Before: 48 matches.
- After: 47 matches.
- P6 target CSS: 0 matches before and after.
- Remaining graph literals are the fixed dark-space and graph-specific palette in the graph-only token block, plus categorical note/folder and plasma scale values in `lib/graph/graphColor.ts`. Those data colors encode graph semantics and are documented in that module; they are not UI chrome colors.
- Dashboard template definitions/imports retain their palettes as user-content preview colors and are excluded from the UI-token grep policy.

## Verification

- `pnpm install --frozen-lockfile` from `app/`: passed.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=2 src/lib/graph src/components/__tests__/healthView.test.ts src/components/__tests__/healthPlaceGroups.test.ts src/components/__tests__/housekeeperPanel.test.ts` from `app/apps/desktop/`: 8 files, 104 tests passed. An earlier unconstrained run timed out one simulation test under concurrent screenshot load; the prescribed two-worker rerun passed.
- `pnpm exec tsc --noEmit` from `app/apps/desktop/`: passed.
- `pnpm exec eslint src/lib/graph/galaxyRenderer.ts` from `app/apps/desktop/`: passed.
- The Chrome headless browser screenshot command sometimes returned exit 2 after writing a complete PNG because its teardown watchdog expired. Output files were checked with `file`; graph images use the 2D fallback because headless Chrome was launched with GPU disabled.
- No packaged application build was run.

## Screenshots and limits

Saved under `/private/tmp/ib-redesign/p67/`:

- Graph, light/dark at 1440×900 and 720×600: `graph-light-1440x900.png`, `graph-dark-1440x900.png`, `graph-light-720x600.png`, `graph-dark-720x600.png`.
- Windows window-simulator shell, light/dark at 1440×900 and 720×600: `simulator-light-1440.png`, `simulator-dark-1440.png`, `simulator-light-720.png`, `simulator-dark-720.png`.

The current window simulator opens a synthetic note, so those four images are shell/layout references rather than dashboard surface captures. Health was removed from the settings UI on 2026-10-04; the pure Health renderer is now embedded in AI finding tools, and the simulator has no direct Health preview route. Therefore dashboard-dialog and Health-specific light/dark screenshots remain unverified. The graph screenshots cover all requested themes and sizes, but only through the 2D fallback; native WebGPU/WebGL rendering was not exercised by these captures.

## Remaining work

- Capture the HomeDashboardDialog/dashboard and AI finding Health surfaces in a harness that can open those states, in light/dark at 1440×900 and 720×600.
- Recheck the graph GPU backend screenshots with a GPU-enabled browser or native app.
- No native Windows WebView2 check or packaged app build was performed.

## Commits

- `feat(desktop): align graph renderer with Orbit palette`

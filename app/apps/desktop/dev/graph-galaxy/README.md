# Galaxy lab

From `app/apps/desktop`, run `pnpm exec vite --mode simulator --host 127.0.0.1 --port 1435 --strictPort` and open `/dev/graph-galaxy/?count=200&platform=macos&theme=dark`.

`count` accepts 200, 2000, or 20000. `platform` selects macos/windows CSS, and `theme` selects light/dark. `renderer=webgl` forces the WebGL2 backend; `renderer=2d` denies GPU contexts to exercise the production fallback. This page mounts the real GraphView, data assembly, galaxy layout, controls and renderer, with synthetic IPC mocks only. It never connects to Tauri or a server. Note opening records `document.body.dataset.openedNote` instead of reading a file.

Run `node dev/graph-galaxy/verify.mjs` with Playwright installed in your test environment. `PLAYWRIGHT_MODULE` may point to its ESM entry; `CHROMIUM_EXECUTABLE` may select a local Chrome binary; `GALAXY_URL` overrides the dev-server origin. The verifier saves screenshots and `performance.json` in `docs/galaxy/`, checks keyboard opening for each dataset/backend, and measures six seconds of real pointer-driven orbit after the force layout settles. First rendered frame, initial settings response, and complete stabilization are reported separately. `window.galaxyLab.measure(ms)` counts submitted render frames, not idle requestAnimationFrame callbacks.

`node dev/graph-galaxy/verify-ui.mjs` checks narrow Windows/macOS layouts, search input, keyboard note opening, reduced motion, automatic WebGL2 fallback without navigator.gpu, and Canvas2D fallback when every GPU context is denied. It uses the same Playwright environment variables.

WebMCP is available only in development harnesses when the browser exposes `document.modelContext` (or the early `navigator.modelContext`). The graph preview registers `galaxy_state`, `filter_graph`, `open_note`, and `measure_fps`; the window simulator registers `app_state`, `list_notes`, `open_note`, and `set_theme`. These tools are dev-only and do not ship with the desktop app.

Use `GALAXY_SUFFIX=-v2` with either verifier to preserve v1 screenshots and write v2 artifacts. The performance verifier records the measured GraphView layout time, asserts the 3,000+ note path skips force and completes layout under one second, and checks the hero becomes transparent after exploration.

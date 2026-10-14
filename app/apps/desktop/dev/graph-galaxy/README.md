# Galaxy lab

From `app/apps/desktop`, run `pnpm exec vite --mode simulator --host 127.0.0.1 --port 1435 --strictPort` and open `/dev/graph-galaxy/?count=200&platform=macos&theme=dark`.

`count` accepts 200, 2000, or 20000. `platform` selects macos/windows CSS, and `theme` selects light/dark. `renderer=webgl` forces the WebGL2 backend; `renderer=2d` denies GPU contexts to exercise the production fallback. This page mounts the real GraphView, data assembly, force worker, controls and renderer, with synthetic IPC mocks only. It never connects to Tauri or a server. Note opening records `document.body.dataset.openedNote` instead of reading a file.

Run `node dev/graph-galaxy/verify.mjs` with Playwright installed in your test environment. `PLAYWRIGHT_MODULE` may point to its ESM entry; `CHROMIUM_EXECUTABLE` may select a local Chrome binary; `GALAXY_URL` overrides the dev-server origin. The verifier saves screenshots and `performance.json` in `docs/galaxy/`, checks keyboard opening for each dataset/backend, and measures six seconds of real pointer-driven orbit after the force layout settles. First rendered frame, initial settings response, and complete stabilization are reported separately. `window.galaxyLab.measure(ms)` counts submitted render frames, not idle requestAnimationFrame callbacks.

`node dev/graph-galaxy/verify-ui.mjs` checks narrow Windows/macOS layouts, search input, keyboard note opening, reduced motion, automatic WebGL2 fallback without navigator.gpu, and Canvas2D fallback when every GPU context is denied. It uses the same Playwright environment variables.

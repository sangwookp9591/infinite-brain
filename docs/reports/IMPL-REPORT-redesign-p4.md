# P4 Orbit editor, viewers, and panels

Date: 2026-10-17

## Changes

- Rounded the main note surface to the Orbit 26px sheet radius and gave the
  version/activity overlay a bordered, inset island treatment.
- Set the default CodeMirror prose size to 14px and the inline title weight to
  600. The existing Fraunces and Pretendard font stacks provide Latin and
  Korean title glyphs.
- Tightened narrow-window editor controls, clamped the presence/backlink
  popovers, and let the compare review list size with its available width.
- Replaced AI change metadata opacity with the secondary text token so the
  label contrast does not depend on opacity over the card surface.
- Kept the existing HTML view transport and sanitization boundary unchanged;
  `HtmlView` still uses its sandboxed iframe and the packaged CSP contract.
  No props, IPC, note behavior, or authorization logic changed.
- Added a theme test asserting at least 4.5:1 contrast for editor body text,
  secondary text, and links on the editor surface in light and dark palettes.
- No token promotion candidates were needed.

## Verification

| Check | Result |
|---|---|
| `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/lib/editor src/__tests__/csp.test.ts` (`app/apps/desktop`) | Passed: 38 files, 371 tests |
| `pnpm exec tsc --noEmit` (`app/apps/desktop`) | Passed |
| `pnpm run lint` (`app/apps/desktop`) | Passed with 0 errors and 50 warnings. Warnings are existing repository warnings; edited TypeScript files introduced none. |
| `git diff --check` | Passed |
| Window simulator, Windows and macOS modes, light/dark, 1440×900 and 720×900 | Captured below. At 720px, document scroll width matched the viewport on both platform modes. |
| Packaged desktop build / native Windows WebView2 | Not run |

Screenshots: `/private/tmp/ib-redesign/p4/` contains `windows-light-1440.png`,
`windows-light-720.png`, `windows-dark-1440.png`, `windows-dark-720.png`, and the
same four `macos-*.png` files. They show the mixed Korean/English fixture note;
the temporary simulator fixture text change was reverted after capture. The
simulator's startup store repaints its theme query as light, so dark captures
set the root `data-theme` after startup. These are browser simulation checks,
not native OS window checks.

## Commits

- `ebf83a5` `feat(desktop): restyle Orbit editor sheets and panels`
- `909ea36` `test(desktop): assert editor contrast in both themes`
- Documentation commit: added with this report.

## Remaining

- Native Windows/WebView2 window behavior and the packaged app CSP/font loading
  remain unverified in this browser simulation.

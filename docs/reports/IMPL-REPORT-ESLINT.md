# ESLint for the desktop app

## Dependencies

Pinned exact versions in `app/apps/desktop/package.json`:

- `eslint` 9.39.5 and `@eslint/js` 9.39.5
- `typescript-eslint` 8.71.2
- `eslint-plugin-react-hooks` 7.1.1
- `globals` 17.13.0

The workspace lockfile was updated with pnpm.

## Configuration

`eslint.config.js` uses flat config with ESLint recommended rules, the fast
non-type-checked TypeScript recommended rules, and browser globals. It covers
`src/**/*.{ts,tsx}` and JavaScript/TypeScript files in `dev/`; build output
(`dist/`), Rust sources (`src-tauri/`), and `coverage/` are ignored. `pnpm lint`
runs with `--cache` (`.eslintcache` is gitignored).

React Hooks `rules-of-hooks` is an error and `exhaustive-deps` is a warning.
The React Hooks compiler preset was not enabled because its additional rules
flagged existing application patterns outside the requested scope. The
configuration also turns off `no-empty-object-type` for prop-extension
interfaces, warns on existing `any` and unused-expression idioms, ignores
underscore-prefixed mock parameters, and permits empty catches. `no-control-regex`
stays at its recommended `error`; the six path/URL validation guards that
intentionally match control characters each carry an inline
`eslint-disable-next-line`.

The first scoped run had 17 errors. The conditional hook calls in account
settings were moved after all hooks, the non-hook `useBulkPath` helper was
renamed to `isBulkPath`, and remaining baseline errors were handled with
behavior-preserving source cleanup or narrow rule configuration. Final lint
count: **0 errors, 45 warnings**; warnings are mainly exhaustive-deps findings,
intentional fixture `any` values, and existing unused lint directives.

## Verification

- `pnpm lint` in `app/apps/desktop/`: **PASS**, 0 errors, 45 warnings.
- `pnpm lint` in `app/` through Turbo: **PASS**, 1 task successful, 0 errors,
  45 warnings.
- `npx tsc --noEmit -p .` in `app/apps/desktop/`: **PASS**.
- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run` on seven related
  files: **PASS**, 7 files and 87 tests.
- `git diff --check`: **PASS**.

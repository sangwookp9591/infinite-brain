# P6 surface previews

Run the window simulator with `pnpm run simulate:windows` or
`pnpm run simulate:macos` from `app/apps/desktop/`, then add one of these
query parameters to the simulator URL:

- `surface=home` opens the synthetic Home dashboard note in the real app shell.
- `surface=dashboard-dialog` opens the new Home dashboard flow.
- `surface=dashboard-manage` opens the saved dashboards manager.
- `surface=health` mounts the pure Health renderer with synthetic local and
  Remote Vault stats.
- `surface=housekeeper` mounts the Housekeeper panel with local API fixtures.

Add `theme=light` or `theme=dark`, and use a 1440×900 or 720×600 viewport for
the P6 review captures. All fixture data is synthetic; the Housekeeper route
replaces its status and diagnosis calls in memory and never contacts a service.

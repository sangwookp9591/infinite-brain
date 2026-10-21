# P6 surface previews

Run the window simulator with `pnpm run simulate:windows` or
`pnpm run simulate:macos` from `app/apps/desktop/`, then add one of these
query parameters to the simulator URL:

- `surface=home` opens the synthetic Home dashboard note in the real app shell.
- `surface=dashboard-dialog` opens the new Home dashboard flow.
- `surface=dashboard-manage` opens the saved dashboards manager.
- `surface=health` mounts the pure Health renderer with synthetic local and
  Remote Vault stats.
- `surface=onboarding` plays the first-launch intro on its own.
- `surface=housekeeper` mounts the Housekeeper panel with local API fixtures.
- `surface=office` mounts the synthetic office collaboration preview. Use
  `officeScenario=duplicates` for duplicate candidate names or
  `officeScenario=error` for a connection failure.

Add `theme=light` or `theme=dark`, and use a 1440×900 or 720×600 viewport for
the P6 review captures. All fixture data is synthetic; the Housekeeper route
replaces its status and diagnosis calls in memory and never contacts a service.

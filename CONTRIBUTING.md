# Contributing

Thanks for your interest in improving ServerMonitor.

## Development

```bash
npm install
npm run dev        # http://localhost:3000  (and /cluster)
```

The app reads live metrics from the host it runs on, so most panels only show
real numbers on a Linux machine (metrics come from `/proc`, `/sys`, and a few
shell tools). On macOS/Windows the Linux-only collectors degrade to `N/A`; the
pure logic is still covered by the tests.

## Before opening a pull request

Run the same checks CI runs, and make sure they pass:

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm test               # Vitest
```

`npm run format` fixes formatting in place.

## Guidelines

- **Metrics degrade to `N/A`, never to a fake `0`.** When a source is missing,
  return `N/A` and push a reason onto the `warnings` array (see
  `collect()` in `src/utils/collectors/shell.ts`) — don't invent a value.
- **New API fields are optional.** Cluster nodes may run older versions, so add
  new `ServerData` fields as optional and fill defaults in
  `src/utils/dashboardData.ts`.
- **Don't leak secrets.** The process list reports executable names only
  (`comm`, never full command lines). Keep it that way.
- **Mind the kiosk layout.** The dashboard is tuned to fit a 1024×600 panel;
  see the **Layout** section of the README before changing card contents or
  the per-panel row caps.
- Add a test when you touch pure logic (parsers, formatters, alert rules).

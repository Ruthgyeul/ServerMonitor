# ServerMonitor

A self-hosted, real-time server monitoring dashboard built with Next.js. It
reads live system metrics (CPU, memory, disk, network, temperature, fan
speed, uptime, top processes) from the host it runs on and exposes them
through a small dashboard UI and a JSON API, with an optional cluster view
that aggregates several nodes on one screen.

![ServerMonitor screenshot](public/screenshots/home.png)

## Features

- **Live dashboard** (`/`) — one responsive layout, from a phone to a 7-inch
  kiosk panel (see [Layout](#layout)), polling `/api/system` every second:
  - CPU/GPU/RAM/disk gauges, per-core bars, and a 24-hour hourly load heatmap
  - load average with a 12-hour history grid, swap, and disk I/O throughput
  - network throughput chart, interfaces, link utilisation, ping, error
    rates, established connections and listening ports
  - temperature against its alert threshold, fan RPM, uptime and last reboot
  - alert log, top processes, SSH sessions, top traffic peers, firewall state
  - keeps the last known values on screen when a poll fails, and says so in
    the header instead of blanking the display
- **Cluster view** (`/cluster`) — a compact grid that polls multiple
  ServerMonitor instances (e.g. an x86 server plus several Raspberry Pi
  nodes) and shows their status side by side.
- **JSON API** (`/api/system`) — returns the current metrics for the host,
  with a configurable CORS allow-list for cross-node requests.
- **Kiosk launch script** — boots the dashboard full-screen in Firefox for
  a dedicated status display.

## Layout

The three columns and the card order inside each one come from the design and
are fixed in `Dashboard.tsx` — nothing is auto-placed, so no viewport ever
reshuffles the cards:

| Column | Cards, in order |
| --- | --- |
| Left | uptime · load average + 12h grid · CPU cores · swap · disk I/O · fan + CPU temp |
| Centre | CPU/GPU/RAM/disk gauges · 24h CPU heatmap · network chart · interfaces + bandwidth · ping/err/conns/ports |
| Right | alerts log · top processes · SSH sessions · top traffic IPs · firewall |

Only how many columns stand side by side changes with the viewport:

| Viewport | Columns |
| --- | --- |
| < 640px | 1 — the three columns stack in order |
| 640–1023px | 2 — the right column drops below the left |
| ≥ 1024px | 3, at the design's own 238:472:282 proportions |
| ≥ 960px **and** ≤ 700px tall | 3, at reduced density |

That last row is the 7-inch kiosk panel (1024x600), where every card has to be
on screen at once. The arrangement there is identical — same columns, same
order — and only the sizes shrink: type scale, padding, gauge diameter, chart
and sparkline heights. All of it is one media query in
`src/styles/globals.css`, and the components carry semantic classes
(`t-label`, `dash-card`, `dash-chart`) rather than hardcoded sizes, so
retuning is a matter of editing that block.

Two things to know before changing it:

- The width trigger is 960px rather than 1024px on purpose. If the cards ever
  overflow on a 1024px-wide panel a scrollbar appears, dropping the viewport
  below 1024 — with the trigger at 1024 that would switch the type back up and
  overflow further, a loop. 960 leaves room for the scrollbar.
- The per-panel row caps in `Dashboard.tsx` (`MAX_PROCESSES`, `MAX_INTERFACES`
  and friends) are what bound each card's height. The kiosk layout was checked
  against a 16-core host with six interfaces and every list full, and clears
  600px with roughly 28px to spare per column; raising a cap eats into that.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React + TypeScript
- Tailwind CSS
- Hand-rolled SVG charts on the main dashboard (viewBox-based, so they scale
  with the card instead of being measured); Recharts on the cluster view
- `src/utils/systemMonitor.ts` and `src/utils/collectors/*`, which read
  metrics straight from `/proc` and `/sys` and shell out only for `df`, `ps`,
  `ping`, `who`, `last`, `systemctl` and `journalctl`

## Getting started

### Prerequisites

- Node.js 18+
- A Linux host (metrics come from `/proc/stat`, `/proc/meminfo`,
  `/proc/net/route`, `/sys/class/net`, `/sys/class/thermal`, …)
- `lm-sensors` is optional. Install it for per-chip temperatures and fan RPM;
  without it those fall back to `/sys/class/thermal` and `/sys/class/hwmon`,
  and anything still unavailable reads `N/A` rather than zeroing the dashboard

Every panel degrades to `N/A` (never to a fake zero) when its source is
missing. A few need more than `/proc` to show real numbers:

| Panel | Needs |
| --- | --- |
| GPU usage/temperature | an AMD card (`gpu_busy_percent` in sysfs) or `nvidia-smi`. Intel iGPUs have no percentage to read, so they stay `N/A`. |
| Top traffic IPs (in bytes) | `nf_conntrack` with `net.netfilter.nf_conntrack_acct=1`. Without it the panel ranks peers by open connections instead. |
| Firewall blocked attempts | read access to the kernel journal (usually membership in `systemd-journal` or `adm`). |
| Last reboot reason | readable `/var/log/wtmp` and a `last` binary; reports whether the previous shutdown was clean. |

The 12-hour load grid and 24-hour CPU heatmap are kept in memory by the
running process, so they start empty after a restart and fill in over time.

If a metric looks wrong on a real host, `./scripts/diagnose.sh` prints what
each of those sources actually returns, and `curl localhost:3000/api/system`
includes a `warnings` array naming any collector that failed.

### Install

```bash
npm install
```

### Configure environment variables

All environment-specific values (cluster node IPs, allowed CORS origins,
site metadata, kiosk settings) live in a single `.env` file instead of being
hardcoded, so the app can be reused across servers/domains without editing
source code.

```bash
cp .env.example .env
```

Then edit `.env` to match your own setup. See
[Environment variables](#environment-variables) below for what each value
does.

### Run

```bash
# development
npm run dev

# production
npm run build
npm run start
```

Open [http://localhost:3000](http://localhost:3000) for the single-server
dashboard, or `/cluster` for the multi-node view.

## Environment variables

`.env.example` documents every supported variable. `NEXT_PUBLIC_*` values are
inlined into the client bundle at build time (needed because the cluster
dashboard fetches other nodes directly from the browser); the rest are only
read on the server.

| Variable | Used in | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_CLUSTER_SERVERS` | `src/config/clusterConfig.ts` | JSON array of `{ "name", "ip", "type" }` objects rendered on `/cluster`. `type` is `"intel"` or `"rpi"` and controls which sensors are read. |
| `NEXT_PUBLIC_CLUSTER_PORT` | `src/config/clusterConfig.ts` | Port each cluster node's `/api/system` listens on (default `3000`). |
| `NEXT_PUBLIC_CLUSTER_PROTOCOL` | `src/config/clusterConfig.ts` | Scheme (`http`/`https`) used to reach cluster nodes from the browser (default `http`). |
| `ALLOWED_ORIGINS` | `src/app/api/system/route.ts` | Comma-separated list of origins allowed to call `/api/system` (CORS allow-list). |
| `NEXT_PUBLIC_SITE_URL` | `src/config/siteConfig.ts` | Canonical site URL used for metadata, Open Graph tags, `robots.txt` and `sitemap.xml`. |
| `NEXT_PUBLIC_SITE_NAME` | `src/config/siteConfig.ts` | Full site/app name shown in page titles and metadata. |
| `NEXT_PUBLIC_SITE_SHORT_NAME` | `src/config/siteConfig.ts` | Short name used in the title template and mobile web app title. |
| `NEXT_PUBLIC_SITE_DESCRIPTION` | `src/config/siteConfig.ts` | Site description used in metadata and social previews. |
| `NEXT_PUBLIC_AUTHOR_NAME` | `src/config/siteConfig.ts` | Author/creator/publisher metadata. |
| `PING_HOST` | `src/utils/systemMonitor.ts` | Host pinged for the latency reading. Defaults to `8.8.8.8`; set it to a reachable host if outbound ICMP is blocked, otherwise ping shows `0`. |
| `KIOSK_USER` | `scripts/run.sh` | Linux user whose Firefox session is killed/relaunched in kiosk mode. |
| `KIOSK_URL` | `scripts/run.sh` | URL opened in kiosk mode. |

Adding, removing, or repointing a cluster node is now a one-line edit in
`.env` — no code changes or redeploy of the dashboard logic required.

## Scripts

- `scripts/diagnose.sh` — prints the raw contents of every source the API
  reads, so you can see which metric is unavailable on a given host.
- `scripts/run.sh` — launches the dashboard full-screen in Firefox kiosk
  mode, reading `KIOSK_USER`/`KIOSK_URL` from `.env` if present.
- `scripts/monitor.sh` — standalone JSON dump of the same metrics. Not used by
  the API route; kept for shelling out from other tooling.

## Deploying a cluster

Each node in `NEXT_PUBLIC_CLUSTER_SERVERS` should run its own instance of
this app (so its `/api/system` endpoint is reachable at
`http://<ip>:<NEXT_PUBLIC_CLUSTER_PORT>`), and each node's `ALLOWED_ORIGINS`
should include the origin of whichever instance is displaying `/cluster`.

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

# ServerMonitor

A self-hosted, real-time server monitoring dashboard built with Next.js. It
reads live system metrics (CPU, memory, disk, network, temperature, fan
speed, uptime, top processes) from the host it runs on and exposes them
through a small dashboard UI and a JSON API, with an optional cluster view
that aggregates several nodes on one screen.

![ServerMonitor screenshot](public/screenshots/home.png)

## Features

- **Live dashboard** (`/`) — polls `/api/system` every second and renders in
  one of two layouts (see [Layouts](#layouts)):
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

## Layouts

The dashboard ships two layouts and picks one from the viewport on load and
on every resize/orientation change:

| Layout | When | Behaviour |
| --- | --- | --- |
| **Kiosk** | the 1024x600 canvas fits at ≥ 0.8 scale — i.e. ≥ 819x480 CSS px | the fixed three-column design, scaled as a whole and letterboxed. The 7-inch panel (1024x600) renders it at scale 1.0, exactly as designed. |
| **Responsive** | anything smaller — phones, portrait tablets, narrow windows | the same panels reflowed into a scrolling 1/2/3-column grid with larger type, horizontal per-core bars, and the host name added to the header. |

The threshold is deliberately well below the kiosk panel's own scale, so a
7-inch display never falls into the responsive layout. If a kiosk browser
still reports an odd viewport, `?kiosk=1` forces the fixed layout and
`?kiosk=0` forces the responsive one:

```bash
KIOSK_URL=http://localhost:3000/?kiosk=1
```

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React + TypeScript
- Tailwind CSS
- Hand-rolled SVG charts on the main dashboard (viewBox-based, so the same
  component serves both layouts); Recharts on the cluster view
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

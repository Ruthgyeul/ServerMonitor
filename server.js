// server.js — custom Node server wrapping Next.js.
//
// Reason this exists: the kiosk display at /monitor should show live data
// without going through the DASHBOARD_PASSWORD login flow, but only when the
// browser is running ON THIS MACHINE (the physical kiosk attached to this
// server), never over the network. `next start`'s single listener gives Route
// Handlers only a portable Fetch `Request` with no socket access, so there is
// no way to ask "did this connection literally originate on this host" from
// inside the app — and a header-based guess (X-Forwarded-For, Host) is
// spoofable by anyone on the LAN once the app is reachable there, which it
// needs to be for the network dashboard.
//
// The fix is a second HTTP listener bound explicitly to 127.0.0.1. Binding to
// that address (rather than 0.0.0.0) means the OS itself refuses any
// connection that didn't originate on this host, so nothing here has to trust
// a header or parse an address. Only requests that arrive through that
// listener get the internal trust header that lets requireApiAuth() skip the
// password gate (src/utils/apiAuth.ts).
//
// Docker note: docker-compose.yml runs this service with `network_mode: host`,
// so binding to 127.0.0.1 inside the container is the host's real loopback —
// no extra port-publish configuration is needed. If this is ever deployed
// without host networking, do NOT publish the bypass port with a plain
// `-p PORT:PORT` (that republishes it on the host's 0.0.0.0 and defeats the
// whole point) — bind the host side explicitly, e.g. `-p 127.0.0.1:3001:3001`.

// `next start` always serves the production build regardless of any prior
// NODE_ENV; a custom server gets no such default, so replicate it here
// before anything else reads process.env. There's no supported dev workflow
// for this file (use `next dev` for that), so this is unconditional.
process.env.NODE_ENV = 'production';

// A custom server doesn't get Next's automatic .env/.env.production loading
// the way `next dev`/`next start` do, so without this, KIOSK_BYPASS_ENABLED
// and friends would read as unset for anyone following the documented
// `npm run build && npm run start` bare-metal flow (Docker/systemd happen to
// work anyway because they inject real process env vars). Must run before
// any process.env read below.
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd(), false);

const { createServer } = require('http');
const next = require('next');

// The only thing that makes requireApiAuth() trust x-internal-loopback
// (src/utils/apiAuth.ts) is this exact marker being set — never a header
// value alone. A header is something any client on the network-facing
// listener could send verbatim; running `next dev`/`next start` directly
// (skipping this file entirely) never sets this marker, so that path can
// never honor the header no matter what a client sends it. Only this
// process, only via this line, ever sets it.
process.env.__SERVERMONITOR_CUSTOM_SERVER = '1';

const app = next({ dev: false });
const handle = app.getRequestHandler();

const PORT = Number(process.env.PORT) || 3000;
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
const LOOPBACK_HEADER = 'x-internal-loopback';
const BYPASS_ENABLED = /^(1|true|yes)$/i.test(process.env.KIOSK_BYPASS_ENABLED ?? '');
const BYPASS_PORT = Number(process.env.KIOSK_BYPASS_PORT) || 3001;

app.prepare().then(() => {
  // Main listener: identical behaviour to `next start`. Any client-supplied
  // copy of the trust header is stripped before Next ever sees it, so nobody
  // can smuggle the bypass in through the network-facing port by just sending
  // the header themselves.
  createServer((req, res) => {
    delete req.headers[LOOPBACK_HEADER];
    handle(req, res);
  }).listen(PORT, HOSTNAME, () => {
    console.log(`> Ready on http://${HOSTNAME}:${PORT}`);
  });

  if (BYPASS_ENABLED && BYPASS_PORT !== PORT) {
    createServer((req, res) => {
      req.headers[LOOPBACK_HEADER] = '1';
      handle(req, res);
    }).listen(BYPASS_PORT, '127.0.0.1', () => {
      console.log(`> Kiosk loopback bypass on http://127.0.0.1:${BYPASS_PORT} (local-only, no password)`);
    });
  } else if (BYPASS_ENABLED) {
    console.error(
      `KIOSK_BYPASS_PORT (${BYPASS_PORT}) must differ from PORT (${PORT}); bypass listener not started.`
    );
  }
});

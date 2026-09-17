# syntax=docker/dockerfile:1

# ServerMonitor multistage image. The runtime runs a custom server (server.js)
# with full production node_modules rather than Next's standalone output,
# because the kiosk loopback-bypass listener needs the public next() API. The
# sensors/ping/ps/df/last/who tools that metric collection reads use the
# host's binaries and /proc, /sys, so they are not baked into the image — see
# docker-compose.yml's mount/namespace settings.

FROM node:20-alpine AS deps
WORKDIR /app
# Reproducible install from the lockfile. Copy package*.json first to keep the layer cache.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* is inlined into the bundle at build time. To change cluster/site
# metadata, pass it via --build-arg, or use server-only variables read at runtime after deploy.
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install the host tools the metric collectors shell out to. busybox's ps
# doesn't support `-eo ... --sort`, so GNU procps is needed; the same goes for
# sensors/ping. journalctl/systemctl/who/last (systemd/utmp) are hard to get in
# a container, but the collectors already degrade gracefully to N/A, so they're
# not included. Must be used with pid:host + the /proc, /sys mounts (docker-compose.yml) to read the host.
RUN apk add --no-cache procps lm-sensors iputils

# Don't run as root. The custom server.js (loopback-only kiosk bypass
# listener, see src/utils/apiAuth.ts) calls Next's public next() API, which
# standalone's pruned node_modules doesn't include — install production deps
# in full instead of copying .next/standalone.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --chown=nextjs:nodejs server.js ./server.js

# The history/alert persistence location (gitignored data/). Mount as a volume to survive restarts.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME /app/data

USER nextjs
EXPOSE 3000
# Only bound when KIOSK_BYPASS_ENABLED=1 (see .env.example) — password-free,
# loopback-only kiosk access. Never publish this on a container network that
# isn't the host's (docker-compose.yml uses network_mode: host for this reason).
EXPOSE 3001

# Health-check via the lightweight /api/health rather than the heavy /api/system.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]

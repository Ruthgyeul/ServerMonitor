import { NextResponse } from 'next/server';

import { expectedSessionToken, isTrustedLoopbackRequest, requireApiAuth } from '@/utils/apiAuth';
import { enforceActionRateLimit } from '@/utils/rateLimit';
import { rejectCrossSite } from '@/utils/sameOrigin';

// Gate for the opt-in control actions (start/stop containers, restart units,
// run jobs, prune Docker). Every check must pass, in this order:
//
//   1. a valid login (DASHBOARD_PASSWORD / API_AUTH_TOKEN) — and the gate is
//      never satisfied without one, so an open dashboard can't control anything
//   2. CONTROL_ENABLED=true
//   3. not the kiosk's loopback connection (read-only by design)
//   4. same-origin, and within the strict action rate budget
//   5. the caller's address inside CONTROL_ALLOWED_CIDRS (default 192.168.0.0/24),
//      taken from the socket by server.js — never from a client header
//   6. the target named in CONTROL_ALLOWLIST_CONTAINERS / CONTROL_ALLOWLIST_UNITS
//      (or CONTROL_ALLOW_PRUNE=true for prune / image removal)
//
// Commands then run through execFile with argument arrays (no shell).

export const PEER_HEADER = 'x-servermonitor-peer';
const DEFAULT_CIDRS = '192.168.0.0/24';

const truthy = (value: string | undefined) => /^(1|true|yes)$/i.test(value ?? '');

export interface Cidr {
  base: number;
  mask: number;
}

export interface Allowlist {
  all: boolean;
  names: Set<string>;
}

export interface ControlConfig {
  enabled: boolean;
  cidrs: Cidr[];
  containers: Allowlist;
  units: Allowlist;
  prune: boolean;
  trustProxy: boolean;
}

// Pure: dotted IPv4 (also IPv4-mapped IPv6, "::ffff:192.168.0.5") → 32-bit int.
export function ipv4ToInt(address: string): number | null {
  const ip = address.trim().replace(/^::ffff:/i, '');
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

// Pure: "192.168.0.0/24" (or a bare address = /32) → base and mask.
export function parseCidr(spec: string): Cidr | null {
  const [address, bitsRaw] = spec.trim().split('/');
  const base = ipv4ToInt(address ?? '');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

export function inCidrs(address: string, cidrs: Cidr[]): boolean {
  const ip = address.trim() === '::1' ? ipv4ToInt('127.0.0.1') : ipv4ToInt(address);
  if (ip === null) return false;
  return cidrs.some(cidr => (ip & cidr.mask) >>> 0 === cidr.base);
}

function parseAllowlist(raw: string | undefined): Allowlist {
  const names = (raw ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);
  return { all: names.includes('*'), names: new Set(names.filter(name => name !== '*')) };
}

export function parseControlConfig(env: Record<string, string | undefined>): ControlConfig {
  const cidrs = (env.CONTROL_ALLOWED_CIDRS?.trim() || DEFAULT_CIDRS)
    .split(',')
    .map(parseCidr)
    .filter((cidr): cidr is Cidr => cidr !== null);
  return {
    enabled: truthy(env.CONTROL_ENABLED),
    cidrs,
    containers: parseAllowlist(env.CONTROL_ALLOWLIST_CONTAINERS),
    units: parseAllowlist(env.CONTROL_ALLOWLIST_UNITS),
    prune: truthy(env.CONTROL_ALLOW_PRUNE),
    trustProxy: truthy(env.CONTROL_TRUST_PROXY)
  };
}

export function allows(list: Allowlist, name: string): boolean {
  return list.all || list.names.has(name);
}

// The caller's address. server.js stamps the socket's peer address on every
// request (overwriting any client copy); behind a reverse proxy on this host
// (peer is loopback) X-Forwarded-For is used only with CONTROL_TRUST_PROXY.
// Without the bundled server there is no trustworthy address: null.
export function clientAddress(request: Request, config: ControlConfig): string | null {
  if (process.env.__SERVERMONITOR_CUSTOM_SERVER !== '1') return null;
  const peer = request.headers.get(PEER_HEADER);
  if (!peer) return null;
  const loopback = peer === '::1' || peer.replace(/^::ffff:/i, '').startsWith('127.');
  if (loopback && config.trustProxy) {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return peer;
}

export type ControlTarget =
  { kind: 'container'; name: string } | { kind: 'unit'; name: string } | { kind: 'prune' };

const forbidden = (error: string) => NextResponse.json({ success: false, error }, { status: 403 });

// Returns an error Response when the action must not run, or null to proceed.
export function authorizeControl(
  request: Request,
  target: ControlTarget,
  config: ControlConfig = parseControlConfig(process.env)
): Response | null {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;
  if (!config.enabled) return forbidden('Control actions are off (set CONTROL_ENABLED=true)');
  if (expectedSessionToken() === null) {
    return forbidden('Control actions need dashboard login (set DASHBOARD_PASSWORD)');
  }
  if (isTrustedLoopbackRequest(request)) return forbidden('The kiosk connection is read-only');
  const blocked = rejectCrossSite(request) ?? enforceActionRateLimit(request);
  if (blocked) return blocked;

  const address = clientAddress(request, config);
  if (address === null || !inCidrs(address, config.cidrs)) {
    return forbidden('Control actions are not allowed from this address (CONTROL_ALLOWED_CIDRS)');
  }

  switch (target.kind) {
    case 'container':
      return allows(config.containers, target.name)
        ? null
        : forbidden(`${target.name} is not in CONTROL_ALLOWLIST_CONTAINERS`);
    case 'unit':
      return allows(config.units, target.name)
        ? null
        : forbidden(`${target.name} is not in CONTROL_ALLOWLIST_UNITS`);
    case 'prune':
      return config.prune ? null : forbidden('Pruning is off (set CONTROL_ALLOW_PRUNE=true)');
  }
}

// What the UI needs to enable or explain each button. No addresses are
// included; the allowlists are names the operator chose.
export interface ControlStatus {
  enabled: boolean;
  reason: string | null;
  containers: string[] | '*';
  units: string[] | '*';
  prune: boolean;
}

export function controlStatus(config: ControlConfig = parseControlConfig(process.env)): ControlStatus {
  const reason = !config.enabled
    ? 'Set CONTROL_ENABLED=true to use control actions'
    : expectedSessionToken() === null
      ? 'Control actions need dashboard login (DASHBOARD_PASSWORD)'
      : null;
  const list = (allowlist: Allowlist) => (allowlist.all ? '*' : [...allowlist.names]);
  return {
    enabled: reason === null,
    reason,
    containers: list(config.containers),
    units: list(config.units),
    prune: config.prune
  };
}

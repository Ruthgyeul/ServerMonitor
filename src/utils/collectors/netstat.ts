import os from 'os';
import { readFile, readdir } from 'fs/promises';

import { NetworkInterfaceInfo, TrafficPeer } from '@/types/system';
import { readSys } from '@/utils/collectors/shell';

// Linux network interface names are restricted to this charset (see netdevice(7)).
// Validating against it before touching sysfs paths keeps a value derived from
// command output from ever being treated as a path traversal.
export const INTERFACE_NAME_PATTERN = /^[a-zA-Z0-9@.:_-]+$/;

const TCP_ESTABLISHED = '01';
const TCP_LISTEN = '0A';

// --- /proc/net/tcp parsing -----------------------------------------------

// The sysfs address is little-endian hex in 4-byte words. "0100007F" is 127.0.0.1.
function hexToIpv4(hex: string): string {
  const bytes = hex.match(/../g);
  if (!bytes || bytes.length !== 4) return '0.0.0.0';
  return bytes
    .reverse()
    .map(byte => parseInt(byte, 16))
    .join('.');
}

function hexToIpv6(hex: string): string {
  const words = hex.match(/.{8}/g);
  if (!words || words.length !== 4) return '::';

  // Each 32-bit word is individually little-endian, so reverse bytes within a word only.
  const bytes = words.flatMap(word => (word.match(/../g) ?? []).reverse().map(b => parseInt(b, 16)));
  if (bytes.length !== 16) return '::';

  // IPv4-mapped (::ffff:a.b.c.d) is easier to read shown as IPv4.
  const isMapped = bytes.slice(0, 10).every(b => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isMapped) return bytes.slice(12).join('.');

  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  }

  // Collapse the single longest run of zeros to "::" (RFC 5952).
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i += 1) {
    if (i < groups.length && groups[i] === '0') {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start > bestLength) {
        bestStart = start;
        bestLength = i - start;
      }
      start = -1;
    }
  }

  if (bestLength < 2) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`;
}

interface Socket {
  localPort: number;
  remoteIp: string;
  state: string;
  // The owning UID and inode of the socket. Used to link an SSH session to a
  // process (inode) or infer the user (uid). Columns may be missing on some
  // kernels, so defaults are provided.
  uid: number;
  inode: string;
}

async function readSockets(path: string, ipv6: boolean): Promise<Socket[]> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf-8');
  } catch {
    return []; // tcp6 is absent on kernels with IPv6 disabled
  }

  const sockets: Socket[] = [];
  for (const line of contents.split('\n').slice(1)) {
    // /proc/net/tcp columns: sl local rem st tx:rx tr:when retr uid timeout inode ...
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;

    const [, localPortHex] = fields[1].split(':');
    const [remoteHex] = fields[2].split(':');
    if (!localPortHex || !remoteHex) continue;

    const uid = fields.length > 7 ? parseInt(fields[7], 10) : NaN;

    sockets.push({
      localPort: parseInt(localPortHex, 16),
      remoteIp: ipv6 ? hexToIpv6(remoteHex) : hexToIpv4(remoteHex),
      state: fields[3],
      uid: Number.isNaN(uid) ? -1 : uid,
      inode: fields.length > 9 ? fields[9] : '0'
    });
  }
  return sockets;
}

async function readAllSockets(): Promise<Socket[]> {
  const [v4, v6] = await Promise.all([
    readSockets('/proc/net/tcp', false),
    readSockets('/proc/net/tcp6', true)
  ]);
  return [...v4, ...v6];
}

export interface SocketSummary {
  connections: number;
  listeningPorts: number;
  peers: Map<string, number>;
}

export async function getSocketSummary(): Promise<SocketSummary> {
  const sockets = await readAllSockets();

  const listening = new Set<number>();
  const peers = new Map<string, number>();
  let connections = 0;

  for (const socket of sockets) {
    if (socket.state === TCP_LISTEN) {
      listening.add(socket.localPort);
      continue;
    }
    if (socket.state !== TCP_ESTABLISHED) continue;

    connections += 1;
    // Connections between local processes (127.0.0.1) are noise for "who is using traffic".
    if (isLoopback(socket.remoteIp)) continue;
    peers.set(socket.remoteIp, (peers.get(socket.remoteIp) ?? 0) + 1);
  }

  return { connections, listeningPorts: listening.size, peers };
}

function isLoopback(ip: string): boolean {
  return ip.startsWith('127.') || ip === '::1' || ip === '0.0.0.0' || ip === '::';
}

export interface EstablishedConnection {
  localPort: number;
  remoteIp: string;
  uid: number;
  inode: string;
}

// All ESTABLISHED TCP connections. The security collector filters these to the
// SSH ports to reconstruct sessions.
export async function getEstablishedConnections(): Promise<EstablishedConnection[]> {
  const sockets = await readAllSockets();
  return sockets
    .filter(socket => socket.state === TCP_ESTABLISHED)
    .map(({ localPort, remoteIp, uid, inode }) => ({ localPort, remoteIp, uid, inode }));
}

// --- Interfaces ----------------------------------------------------------

// `ip route` lives in /usr/sbin and is easily missing from a service PATH.
// Reading /proc/net/route directly needs no external binary at all.
export async function getDefaultInterface(): Promise<string> {
  const contents = await readFile('/proc/net/route', 'utf-8');
  const lines = contents.split('\n').slice(1);

  for (const line of lines) {
    const [iface, destination] = line.trim().split(/\s+/);
    if (destination === '00000000' && iface && INTERFACE_NAME_PATTERN.test(iface)) {
      return iface;
    }
  }

  // With no default route (containers, etc.), fall back to the physical interface with the most traffic.
  const candidates = await listInterfaceNames();
  let best = '';
  let bestBytes = -1;
  for (const name of candidates) {
    const bytes = await readInterfaceStat(name, 'rx_bytes');
    if (bytes > bestBytes) {
      best = name;
      bestBytes = bytes;
    }
  }

  if (!best) throw new Error('no usable network interface found');
  return best;
}

async function listInterfaceNames(): Promise<string[]> {
  return (await readdir('/sys/class/net')).filter(name => name !== 'lo' && INTERFACE_NAME_PATTERN.test(name));
}

export async function readInterfaceStat(interfaceName: string, stat: string): Promise<number> {
  const contents = await readSys(`/sys/class/net/${interfaceName}/statistics/${stat}`);
  const value = contents === null ? NaN : parseInt(contents, 10);
  return Number.isNaN(value) ? 0 : value;
}

async function readLinkSpeed(interfaceName: string): Promise<number | null> {
  // Virtual/wireless devices have no speed file or return EINVAL, and it's -1 when the link is down.
  const raw = await readSys(`/sys/class/net/${interfaceName}/speed`);
  if (raw === null) return null;
  const speed = parseInt(raw, 10);
  return Number.isNaN(speed) || speed <= 0 ? null : speed;
}

export async function getInterfaces(defaultInterface: string): Promise<NetworkInterfaceInfo[]> {
  const names = await listInterfaceNames();
  const addresses = os.networkInterfaces();

  const interfaces = await Promise.all(
    names.map(async (name): Promise<NetworkInterfaceInfo> => {
      const operstate = (await readSys(`/sys/class/net/${name}/operstate`)) ?? 'unknown';
      const ipv4 = addresses[name]?.find(entry => entry.family === 'IPv4' && !entry.internal);

      return {
        name,
        ip: ipv4?.address ?? null,
        speedMbps: await readLinkSpeed(name),
        state: operstate === 'up' ? 'up' : operstate === 'down' ? 'down' : 'unknown',
        isDefault: name === defaultInterface
      };
    })
  );

  // The default-route interface first, then the ones whose link is up.
  return interfaces.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if ((a.state === 'up') !== (b.state === 'up')) return a.state === 'up' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// --- Top traffic peers ---------------------------------------------------

function localAddresses(): Set<string> {
  const addresses = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) addresses.add(entry.address);
  }
  return addresses;
}

// conntrack gives per-connection byte counts the kernel already tracks.
// The bytes= field is only present when net.netfilter.nf_conntrack_acct=1.
async function readConntrackBytes(): Promise<Map<string, number> | null> {
  let contents: string;
  try {
    contents = await readFile('/proc/net/nf_conntrack', 'utf-8');
  } catch {
    return null; // conntrack module absent or no read permission
  }

  const locals = localAddresses();
  const totals = new Map<string, number>();

  for (const line of contents.split('\n')) {
    if (!line.includes('bytes=')) return null; // byte accounting is off
    const bytes = [...line.matchAll(/bytes=(\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    const addresses = [...line.matchAll(/(?:src|dst)=([0-9a-fA-F.:]+)/g)].map(m => m[1]);

    // The side of the tuple that isn't our address is the remote peer.
    const peer = addresses.find(address => !locals.has(address) && !isLoopback(address));
    if (!peer) continue;

    totals.set(peer, (totals.get(peer) ?? 0) + bytes);
  }

  return totals.size > 0 ? totals : null;
}

export async function getTopTraffic(peers: Map<string, number>, limit = 4): Promise<TrafficPeer[]> {
  const byBytes = await readConntrackBytes();

  if (byBytes) {
    return [...byBytes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([ip, bytes]) => ({ ip, bytes, connections: peers.get(ip) ?? 0 }));
  }

  // Without conntrack, rank by open connection count. Bytes are unknown.
  return [...peers.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ip, connections]) => ({ ip, bytes: null, connections }));
}

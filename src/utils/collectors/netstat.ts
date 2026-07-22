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

// --- /proc/net/tcp 파싱 ---------------------------------------------------

// sysfs 의 주소는 4바이트 워드 단위 리틀엔디언 16진수다. "0100007F" 는 127.0.0.1.
function hexToIpv4(hex: string): string {
  const bytes = hex.match(/../g);
  if (!bytes || bytes.length !== 4) return '0.0.0.0';
  return bytes.reverse().map(byte => parseInt(byte, 16)).join('.');
}

function hexToIpv6(hex: string): string {
  const words = hex.match(/.{8}/g);
  if (!words || words.length !== 4) return '::';

  // 각 32비트 워드가 개별적으로 리틀엔디언이라 워드 안에서만 바이트를 뒤집는다.
  const bytes = words.flatMap(word => (word.match(/../g) ?? []).reverse().map(b => parseInt(b, 16)));
  if (bytes.length !== 16) return '::';

  // IPv4-mapped(::ffff:a.b.c.d)는 IPv4 로 보여주는 편이 읽기 쉽다.
  const isMapped = bytes.slice(0, 10).every(b => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isMapped) return bytes.slice(12).join('.');

  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  }

  // 가장 긴 0 구간 하나를 "::" 로 줄인다 (RFC 5952).
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
}

async function readSockets(path: string, ipv6: boolean): Promise<Socket[]> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf-8');
  } catch {
    return []; // tcp6 는 IPv6 가 꺼진 커널에 없다
  }

  const sockets: Socket[] = [];
  for (const line of contents.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;

    const [, localPortHex] = fields[1].split(':');
    const [remoteHex] = fields[2].split(':');
    if (!localPortHex || !remoteHex) continue;

    sockets.push({
      localPort: parseInt(localPortHex, 16),
      remoteIp: ipv6 ? hexToIpv6(remoteHex) : hexToIpv4(remoteHex),
      state: fields[3]
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
    // 로컬 프로세스끼리의 연결(127.0.0.1)은 "누가 트래픽을 쓰는가" 관점에서 잡음이다.
    if (isLoopback(socket.remoteIp)) continue;
    peers.set(socket.remoteIp, (peers.get(socket.remoteIp) ?? 0) + 1);
  }

  return { connections, listeningPorts: listening.size, peers };
}

function isLoopback(ip: string): boolean {
  return ip.startsWith('127.') || ip === '::1' || ip === '0.0.0.0' || ip === '::';
}

// --- 인터페이스 ------------------------------------------------------------

// `ip route` 는 /usr/sbin 에 있어 서비스 PATH 에서 빠지기 쉽다.
// /proc/net/route 를 직접 읽으면 외부 바이너리가 전혀 필요 없다.
export async function getDefaultInterface(): Promise<string> {
  const contents = await readFile('/proc/net/route', 'utf-8');
  const lines = contents.split('\n').slice(1);

  for (const line of lines) {
    const [iface, destination] = line.trim().split(/\s+/);
    if (destination === '00000000' && iface && INTERFACE_NAME_PATTERN.test(iface)) {
      return iface;
    }
  }

  // 기본 경로가 없으면(컨테이너 등) 트래픽이 가장 많은 물리 인터페이스로 대체한다.
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
  return (await readdir('/sys/class/net')).filter(
    name => name !== 'lo' && INTERFACE_NAME_PATTERN.test(name)
  );
}

export async function readInterfaceStat(interfaceName: string, stat: string): Promise<number> {
  const contents = await readSys(`/sys/class/net/${interfaceName}/statistics/${stat}`);
  const value = contents === null ? NaN : parseInt(contents, 10);
  return Number.isNaN(value) ? 0 : value;
}

async function readLinkSpeed(interfaceName: string): Promise<number | null> {
  // 가상/무선 장치는 speed 파일이 없거나 읽으면 EINVAL 이고, 링크가 내려가 있으면 -1 이다.
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

  // 기본 경로를 쓰는 인터페이스가 맨 위, 그다음 링크가 올라온 것들 순.
  return interfaces.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if ((a.state === 'up') !== (b.state === 'up')) return a.state === 'up' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// --- 상위 트래픽 피어 ------------------------------------------------------

function localAddresses(): Set<string> {
  const addresses = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) addresses.add(entry.address);
  }
  return addresses;
}

// conntrack 은 커널이 이미 세고 있는 연결별 바이트 수를 준다.
// 단 net.netfilter.nf_conntrack_acct=1 일 때만 bytes= 필드가 붙는다.
async function readConntrackBytes(): Promise<Map<string, number> | null> {
  let contents: string;
  try {
    contents = await readFile('/proc/net/nf_conntrack', 'utf-8');
  } catch {
    return null; // conntrack 모듈이 없거나 읽을 권한이 없다
  }

  const locals = localAddresses();
  const totals = new Map<string, number>();

  for (const line of contents.split('\n')) {
    if (!line.includes('bytes=')) return null; // 바이트 계정이 꺼져 있다
    const bytes = [...line.matchAll(/bytes=(\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    const addresses = [...line.matchAll(/(?:src|dst)=([0-9a-fA-F.:]+)/g)].map(m => m[1]);

    // 튜플 양쪽 중 우리 주소가 아닌 쪽이 상대 피어다.
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

  // conntrack 을 못 쓰면 열려 있는 연결 수로 순위를 매긴다. 바이트는 알 수 없다.
  return [...peers.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ip, connections]) => ({ ip, bytes: null, connections }));
}

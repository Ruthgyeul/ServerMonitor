import os from 'os';
import { readFile, readdir, readlink } from 'fs/promises';

import { FirewallInfo, SshSession } from '@/types/system';
import { readSys, run, withTtl } from '@/utils/collectors/shell';
import { getEstablishedConnections } from '@/utils/collectors/netstat';

// --- SSH sessions ----------------------------------------------------------
//
// `who` reads utmp, which is empty in many environments: containers, busybox,
// `UsePAM no`, and sessions with no PTY (scp/sftp/`ssh host cmd`). So `who`
// alone often misses sessions.
//
// Instead we merge two reliable sources. Neither needs root or utmp.
//   1) sshd session processes — /proc/<pid>/comm is sshd (or sshd-session) and
//      cmdline is "sshd: user@pts/0". Gives the login user, tty, and start time.
//      A PTY-less session shows up as "user@notty".
//   2) TCP connections established to an SSH port — /proc/net/tcp gives the
//      remote IP, matched to each sshd process by socket inode.
// Finally we merge `who` by tty to add the IP/time when utmp is present.

// The cmdline of an sshd session process, overwritten by setproctitle.
//   sshd: deploy@pts/1   /  sshd-session: deploy@pts/1   /  sshd: deploy@notty
const SSHD_SESSION = /^(?:sshd|sshd-session):\s+(\S+?)@(pts\/\d+|tty\S+|notty)\b/;
const USER_HZ = 100; // effectively always 100 on Linux; the tick unit of /proc/<pid>/stat.

interface Session extends SshSession {
  tty?: string;
}

// SSH port list used only inside this collector. sshd_config Port + env var + default 22.
async function sshPorts(): Promise<Set<number>> {
  const ports = new Set<number>();

  const config = await readSys('/etc/ssh/sshd_config');
  if (config) {
    for (const match of config.matchAll(/^\s*Port\s+(\d+)/gim)) ports.add(parseInt(match[1], 10));
  }
  for (const raw of (process.env.SSH_PORTS || '').split(',')) {
    const port = parseInt(raw.trim(), 10);
    if (port > 0) ports.add(port);
  }
  if (ports.size === 0) ports.add(22);

  return ports;
}

function isLoopbackIp(ip: string): boolean {
  return ip.startsWith('127.') || ip === '::1' || ip === '0.0.0.0' || ip === '::';
}

// Compute the boot time (epoch ms) once and freeze it. Recomputing it every
// time as Date.now()-os.uptime() jitters by a few ms because os.uptime() is
// quantized to 10ms, which makes the same session's `since` change every
// refresh and causes alerts to reprint "SSH login" endlessly (the real cause of
// the spam). The boot time never changes, so caching it is correct.
const BOOT_MS = Date.now() - os.uptime() * 1000;

// Reconstruct the process start time from the 22nd field of /proc/<pid>/stat
// (ticks since boot). comm can contain spaces/parens, so count from the last ')'.
async function processStart(pid: string): Promise<string> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf-8');
    const afterComm = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    const startTicks = Number(afterComm[19]); // field 22 = index 19 relative to state(3)
    if (!Number.isFinite(startTicks)) return new Date().toISOString();

    return new Date(BOOT_MS + (startTicks / USER_HZ) * 1000).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

interface SshdProc {
  pid: string;
  user: string;
  tty: string;
}

// Walk /proc and pick only sshd session processes. Doesn't rely on ps flags.
async function sshdSessionProcesses(): Promise<SshdProc[]> {
  let entries: string[];
  try {
    entries = await readdir('/proc');
  } catch {
    return []; // no /proc (not Linux)
  }

  const found: SshdProc[] = [];
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue;

    const comm = await readSys(`/proc/${pid}/comm`);
    if (comm !== 'sshd' && comm !== 'sshd-session') continue;

    let cmdline: string;
    try {
      cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf-8')).replace(/\0/g, ' ').trim();
    } catch {
      continue;
    }

    const match = cmdline.match(SSHD_SESSION);
    if (!match) continue; // skip non-session processes like the master/[priv]/[listener]

    found.push({ pid, user: match[1], tty: match[2] });
  }
  return found;
}

// Matches a socket inode held by the sshd process to an established connection
// to find the remote IP. /proc/<pid>/fd is readable only by the owner (or
// root), so null without permission.
async function correlateIp(pid: string, inodeToIp: Map<string, string>): Promise<string | null> {
  let fds: string[];
  try {
    fds = await readdir(`/proc/${pid}/fd`);
  } catch {
    return null;
  }

  for (const fd of fds) {
    let target: string;
    try {
      target = await readlink(`/proc/${pid}/fd/${fd}`);
    } catch {
      continue;
    }
    const match = target.match(/^socket:\[(\d+)\]$/);
    if (match && inodeToIp.has(match[1])) return inodeToIp.get(match[1]) ?? null;
  }
  return null;
}

async function sessionsFromProcesses(): Promise<Session[]> {
  const [ports, connections, procs] = await Promise.all([
    sshPorts(),
    getEstablishedConnections(),
    sshdSessionProcesses()
  ]);

  const sshConnections = connections.filter(c => ports.has(c.localPort) && !isLoopbackIp(c.remoteIp));
  const inodeToIp = new Map(sshConnections.map(c => [c.inode, c.remoteIp]));

  const sessions = await Promise.all(
    procs.map(async (proc): Promise<Session> => ({
      user: proc.user,
      tty: proc.tty,
      ip: (await correlateIp(proc.pid, inodeToIp)) ?? '—',
      since: await processStart(proc.pid)
    }))
  );

  // If the IP couldn't be matched by inode (permissions, etc.) but there is exactly one SSH connection, use it.
  const unresolved = sessions.filter(s => s.ip === '—');
  if (unresolved.length > 0 && sshConnections.length === 1) {
    for (const session of unresolved) session.ip = sshConnections[0].remoteIp;
  }

  return sessions;
}

// A secondary source for when utmp is alive. Gives the IP and exact login time.
//   deploy   pts/1        2024-07-20 14:35 (192.168.0.5)
const WHO_LINE = /^(\S+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\s*(?:\(([^)]*)\))?/;

async function sessionsFromWho(): Promise<Session[]> {
  const output = await run('who 2>/dev/null || true');
  if (!output) return [];

  const sessions: Session[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(WHO_LINE);
    if (!match) continue;

    const [, user, tty, date, time, host] = match;
    if (!host) continue; // no origin means a local console, not SSH

    const since = new Date(`${date}T${time}`);
    sessions.push({
      user,
      tty,
      ip: host,
      since: Number.isNaN(since.getTime()) ? new Date().toISOString() : since.toISOString()
    });
  }
  return sessions;
}

// Merge the two sources by tty. For the same session, take the real IP and the earliest (= true) login time.
function mergeSessions(...lists: Session[][]): SshSession[] {
  const byKey = new Map<string, Session>();

  for (const session of lists.flat()) {
    const key = session.tty ? `${session.user}@${session.tty}` : `${session.user}@${session.ip}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, session);
      continue;
    }
    byKey.set(key, {
      user: session.user,
      tty: existing.tty ?? session.tty,
      ip: existing.ip !== '—' ? existing.ip : session.ip,
      since: existing.since < session.since ? existing.since : session.since
    });
  }

  return [...byKey.values()]
    .map(({ user, ip, since }) => ({ user, ip, since }))
    .sort((a, b) => b.since.localeCompare(a.since)); // most recent login on top
}

export const getSshSessions = withTtl(15_000, async (): Promise<SshSession[]> => {
  const [fromProcesses, fromWho] = await Promise.all([sessionsFromProcesses(), sessionsFromWho()]);
  return mergeSessions(fromProcesses, fromWho);
});

// --- Firewall --------------------------------------------------------------

async function isServiceActive(name: string): Promise<boolean> {
  // systemctl is-active exits 3 when inactive, so `|| true` is needed.
  const output = await run(`systemctl is-active ${name} 2>/dev/null || true`);
  return output === 'active';
}

async function detectFirewall(): Promise<{ status: FirewallInfo['status']; backend: string | null }> {
  // ufw status requires root, but the config file is usually world-readable.
  const ufwConf = await readSys('/etc/ufw/ufw.conf');
  if (ufwConf !== null) {
    const enabled = /^ENABLED=yes$/im.test(ufwConf);
    return { status: enabled ? 'active' : 'inactive', backend: 'ufw' };
  }

  for (const service of ['firewalld', 'nftables', 'iptables']) {
    try {
      if (await isServiceActive(service)) return { status: 'active', backend: service };
    } catch {
      // environment without systemctl (containers, etc.). Move to the next candidate.
    }
  }

  return { status: 'unknown', backend: null };
}

// Scanning the kernel log once is expensive, so count only once a minute.
const countBlockedAttempts = withTtl(60_000, async (): Promise<number | null> => {
  let output: string;
  try {
    // NR of 0 means no permission to read the journal, distinct from "0 blocks".
    output = await run(
      `journalctl -k --since=-24h --no-pager 2>/dev/null | awk '/UFW BLOCK|nft.*drop|DPT=.*DROP/ {c++} END {print NR" "(c+0)}'`,
      10_000
    );
  } catch {
    return null;
  }

  const [lines, blocked] = output.split(/\s+/).map(Number);
  if (!lines || Number.isNaN(blocked)) return null;
  return blocked;
});

export const getFirewallInfo = withTtl(30_000, async (): Promise<FirewallInfo> => {
  const [{ status, backend }, blockedAttempts] = await Promise.all([
    detectFirewall(),
    countBlockedAttempts()
  ]);
  return { status, backend, blockedAttempts };
});

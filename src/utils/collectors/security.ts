import os from 'os';
import { readFile, readdir, readlink } from 'fs/promises';

import { FirewallInfo, SshSession } from '@/types/system';
import { readSys, run, withTtl } from '@/utils/collectors/shell';
import { getEstablishedConnections } from '@/utils/collectors/netstat';

// --- SSH 세션 --------------------------------------------------------------
//
// `who` 는 utmp 를 읽는데, utmp 는 여러 환경에서 비어 있다: 컨테이너, busybox,
// `UsePAM no`, PTY 를 안 붙이는 세션(scp/sftp/`ssh host cmd`). 그래서 `who` 하나로는
// 세션을 놓치기 일쑤다.
//
// 대신 두 신뢰할 수 있는 소스를 합친다. 둘 다 root 도 utmp 도 필요 없다.
//   1) sshd 세션 프로세스 — /proc/<pid>/comm 이 sshd(또는 sshd-session)이고
//      cmdline 이 "sshd: user@pts/0" 인 것. 로그인 사용자와 tty, 시작 시각을 준다.
//      PTY 없는 세션은 "user@notty" 로 잡힌다.
//   2) SSH 포트로 확립된 TCP 연결 — /proc/net/tcp 에서 원격 IP 를 준다.
//      각 sshd 프로세스의 소켓 inode 로 연결과 짝지어 IP 를 채운다.
// 마지막으로 `who` 결과를 tty 기준으로 병합해, utmp 가 있을 때의 IP/시각을 보탠다.

// setproctitle 로 덮인 sshd 세션 프로세스의 cmdline.
//   sshd: deploy@pts/1   /  sshd-session: deploy@pts/1   /  sshd: deploy@notty
const SSHD_SESSION = /^(?:sshd|sshd-session):\s+(\S+?)@(pts\/\d+|tty\S+|notty)\b/;
const USER_HZ = 100; // 리눅스에서 사실상 항상 100. /proc/<pid>/stat 의 tick 단위.

interface Session extends SshSession {
  tty?: string;
}

// 수집기 안에서만 쓰는 SSH 포트 목록. sshd_config 의 Port + 환경변수 + 기본 22.
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

// 부팅 시각(epoch ms)은 한 번만 계산해 고정한다. 매번 Date.now()-os.uptime()
// 으로 다시 구하면 os.uptime() 의 10ms 양자화 때문에 값이 수 ms 씩 흔들리고,
// 그러면 같은 세션의 `since` 가 갱신마다 달라져 alerts 가 "SSH login" 을
// 무한히 다시 찍는다(도배의 진짜 원인). 부팅 시각은 변하지 않으므로 캐시가 맞다.
const BOOT_MS = Date.now() - os.uptime() * 1000;

// /proc/<pid>/stat 22번째 필드(부팅 후 tick)로 프로세스 시작 시각을 복원한다.
// comm 에 공백/괄호가 들어갈 수 있어 마지막 ')' 이후부터 센다.
async function processStart(pid: string): Promise<string> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf-8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const startTicks = Number(afterComm[19]); // 필드22 = state(3) 기준 인덱스 19
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

// /proc 를 훑어 sshd 세션 프로세스만 고른다. ps 플래그에 기대지 않는다.
async function sshdSessionProcesses(): Promise<SshdProc[]> {
  let entries: string[];
  try {
    entries = await readdir('/proc');
  } catch {
    return []; // /proc 없음(리눅스 아님)
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
    if (!match) continue; // 마스터/[priv]/[listener] 등 세션이 아닌 프로세스는 건너뛴다

    found.push({ pid, user: match[1], tty: match[2] });
  }
  return found;
}

// sshd 프로세스가 들고 있는 소켓 inode 를 established 연결과 짝지어 원격 IP 를 찾는다.
// /proc/<pid>/fd 는 소유자(또는 root)만 읽을 수 있어, 권한이 없으면 null.
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

  // inode 로 IP 를 못 붙였는데(권한 등) SSH 연결이 딱 하나뿐이면 그걸로 채운다.
  const unresolved = sessions.filter(s => s.ip === '—');
  if (unresolved.length > 0 && sshConnections.length === 1) {
    for (const session of unresolved) session.ip = sshConnections[0].remoteIp;
  }

  return sessions;
}

// utmp 가 살아 있을 때의 보조 소스. IP 와 정확한 로그인 시각을 준다.
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
    if (!host) continue; // 접속지가 없으면 로컬 콘솔이라 SSH 가 아니다

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

// tty 기준으로 두 소스를 합친다. 같은 세션이면 실제 IP 와 이른(=진짜) 로그인 시각을 취한다.
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
    .sort((a, b) => b.since.localeCompare(a.since)); // 최근 접속이 위로
}

export const getSshSessions = withTtl(15_000, async (): Promise<SshSession[]> => {
  const [fromProcesses, fromWho] = await Promise.all([sessionsFromProcesses(), sessionsFromWho()]);
  return mergeSessions(fromProcesses, fromWho);
});

// --- 방화벽 ----------------------------------------------------------------

async function isServiceActive(name: string): Promise<boolean> {
  // systemctl is-active 는 비활성일 때 종료 코드가 3 이라 `|| true` 가 필요하다.
  const output = await run(`systemctl is-active ${name} 2>/dev/null || true`);
  return output === 'active';
}

async function detectFirewall(): Promise<{ status: FirewallInfo['status']; backend: string | null }> {
  // ufw status 는 root 를 요구하지만, 설정 파일은 보통 누구나 읽을 수 있다.
  const ufwConf = await readSys('/etc/ufw/ufw.conf');
  if (ufwConf !== null) {
    const enabled = /^ENABLED=yes$/im.test(ufwConf);
    return { status: enabled ? 'active' : 'inactive', backend: 'ufw' };
  }

  for (const service of ['firewalld', 'nftables', 'iptables']) {
    try {
      if (await isServiceActive(service)) return { status: 'active', backend: service };
    } catch {
      // systemctl 이 없는 환경(컨테이너 등). 다음 후보로 넘어간다.
    }
  }

  return { status: 'unknown', backend: null };
}

// 커널 로그 한 번 훑는 비용이 크므로 1분에 한 번만 센다.
const countBlockedAttempts = withTtl(60_000, async (): Promise<number | null> => {
  let output: string;
  try {
    // NR 이 0 이면 저널을 읽을 권한이 없다는 뜻이라, "차단 0건" 과 구분한다.
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

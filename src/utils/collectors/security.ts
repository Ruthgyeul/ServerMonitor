import { FirewallInfo, SshSession } from '@/types/system';
import { readSys, run, withTtl } from '@/utils/collectors/shell';

// --- SSH 세션 --------------------------------------------------------------

// `who` 는 utmp 를 읽는다. 원격 로그인이면 마지막 괄호 안에 접속지가 붙는다.
//   deploy   pts/1        2024-07-20 14:35 (192.168.0.5)
const WHO_LINE = /^(\S+)\s+\S+\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\s*(?:\((.*)\))?/;

export const getSshSessions = withTtl(15_000, async (): Promise<SshSession[]> => {
  const output = await run('who 2>/dev/null || true');
  if (!output) return [];

  const sessions: SshSession[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(WHO_LINE);
    if (!match) continue;

    const [, user, date, time, host] = match;
    // 접속지가 없으면 물리 콘솔/로컬 tty 라 SSH 세션이 아니다.
    if (!host) continue;

    const since = new Date(`${date}T${time}`);
    sessions.push({
      user,
      ip: host,
      since: Number.isNaN(since.getTime()) ? new Date().toISOString() : since.toISOString()
    });
  }

  // 최근 접속이 위로.
  return sessions.sort((a, b) => b.since.localeCompare(a.since));
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

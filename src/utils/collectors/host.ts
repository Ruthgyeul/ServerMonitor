import os from 'os';

import { HostInfo } from '@/types/system';
import { readSys, run, withTtl } from '@/utils/collectors/shell';

function parseOsRelease(contents: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return fields;
}

// 배포판 이름은 부팅 중에 바뀌지 않는다. 한 번 읽으면 충분하다.
const readDistro = withTtl(60 * 60 * 1000, async (): Promise<string> => {
  const contents = (await readSys('/etc/os-release')) ?? (await readSys('/usr/lib/os-release'));
  if (!contents) return `${os.type()} ${os.release()}`;

  const fields = parseOsRelease(contents);
  // PRETTY_NAME 은 "Ubuntu 22.04.4 LTS" 처럼 길어서 좁은 헤더에 안 들어간다.
  // NAME + VERSION_ID 조합("Ubuntu 22.04")이 더 짧고 정보량은 같다.
  if (fields.NAME && fields.VERSION_ID) return `${fields.NAME} ${fields.VERSION_ID}`;
  return fields.PRETTY_NAME || fields.NAME || `${os.type()} ${os.release()}`;
});

// wtmp 를 뒤져 마지막 재부팅 직전에 정상 종료(shutdown) 기록이 있었는지 본다.
// 있으면 계획된 재부팅, 없으면 커널 패닉/정전처럼 예기치 못한 종료다.
const readRebootReason = withTtl(5 * 60 * 1000, async (): Promise<string | null> => {
  let output: string;
  try {
    output = await run('last -x -F -n 20 reboot shutdown 2>/dev/null || true');
  } catch {
    return null; // last 미설치(busybox 등) 또는 wtmp 권한 없음
  }

  const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
  const rebootIndex = lines.findIndex(line => line.startsWith('reboot'));
  if (rebootIndex === -1) return null;

  const previous = lines[rebootIndex + 1];
  if (!previous) return null;
  return previous.startsWith('shutdown') ? 'clean shutdown' : 'unexpected shutdown';
});

export async function getHostInfo(): Promise<HostInfo> {
  const [distro, rebootReason] = await Promise.all([readDistro(), readRebootReason()]);

  return {
    hostname: os.hostname(),
    os: distro,
    kernel: os.release(),
    arch: os.arch(),
    bootTime: new Date(Date.now() - os.uptime() * 1000).toISOString(),
    rebootReason
  };
}

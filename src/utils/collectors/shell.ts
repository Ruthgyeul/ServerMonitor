import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';

const execAsync = promisify(exec);

// `ip`, `sensors`, `ps` 등은 /usr/sbin, /sbin 에 설치되는 경우가 많은데
// 비-root 사용자로 뜬 systemd/pm2 서비스의 PATH 에는 그 경로가 빠져 있다.
// 그래서 명령이 "not found" 로 끝나고, 지표가 통째로 0 이 된다.
export const EXEC_ENV = {
  ...process.env,
  PATH: [process.env.PATH, '/usr/local/sbin', '/usr/sbin', '/sbin'].filter(Boolean).join(':'),
  LC_ALL: 'C', // 로케일에 따라 소수점이 ','가 되면 parseFloat가 잘라먹는다
  LANG: 'C'
};

export async function run(command: string, timeout = 5000): Promise<string> {
  const { stdout } = await execAsync(command, { env: EXEC_ENV, timeout });
  return stdout.trim();
}

export async function readSys(filePath: string): Promise<string | null> {
  try {
    return (await readFile(filePath, 'utf-8')).trim();
  } catch {
    return null;
  }
}

// 수집기 하나가 실패해도 나머지 지표는 살려 보낸다.
export async function collect<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T,
  warnings: string[]
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${name}: ${message}`);
    console.warn(`[systemMonitor] ${name} failed:`, message);
    return fallback;
  }
}

// 대시보드는 1초마다 폴링한다. `who`, `last`, `nvidia-smi` 처럼 프로세스를
// 띄우는 수집기까지 매 초 돌리면 측정 대상 서버가 더 바빠지므로,
// 잘 변하지 않는 값은 TTL 동안 캐시해서 재사용한다.
export function withTtl<T>(ttlMs: number, fn: () => Promise<T>): () => Promise<T> {
  let value: T;
  let expiresAt = 0;
  let inflight: Promise<T> | null = null;

  return async () => {
    if (expiresAt > Date.now()) return value;
    // 같은 틱에 여러 수집기가 부르더라도 프로세스는 한 번만 띄운다.
    if (inflight) return inflight;

    inflight = fn()
      .then(result => {
        value = result;
        expiresAt = Date.now() + ttlMs;
        return result;
      })
      .finally(() => {
        inflight = null;
      });

    return inflight;
  };
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function round(value: number, digits = 2): number {
  return parseFloat(value.toFixed(digits));
}

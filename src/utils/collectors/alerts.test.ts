import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AlertInput } from '@/utils/collectors/alerts';

// alerts 는 모듈 스코프에 활성 룰/로그/known 상태를 들고 있어 테스트마다 새로
// 불러온다. 저장 파일도 임시 디렉터리로 격리한다. 웹훅 호출은 fetch 를 목으로
// 잡아 호출 횟수만 센다(실제 네트워크로 나가지 않게).
async function freshAlerts(env: Record<string, string> = {}) {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), 'alerts-test-'));
  process.env.DATA_DIR = dir;
  process.env.ALERTS_FILE = join(dir, 'alerts.json');
  process.env.ALERT_WEBHOOK_URL = 'https://example.test/hook';
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const mod = await import('@/utils/collectors/alerts');
  return { ...mod, fetchMock, dir, file: process.env.ALERTS_FILE };
}

function baseInput(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    cpu: 10,
    memory: 10,
    disk: 10,
    swap: 0,
    temperature: 40,
    firewall: 'active',
    sshSessions: [],
    interfaces: [],
    ...overrides
  };
}

const ENV_KEYS = [
  'DATA_DIR',
  'ALERTS_FILE',
  'ALERT_WEBHOOK_URL',
  'ALERT_WEBHOOK_FORMAT',
  'ALERT_CPU_ENTER',
  'ALERT_CPU_CLEAR',
  'ALERT_RENOTIFY_MINUTES'
];

describe('evaluateAlerts', () => {
  beforeEach(() => ENV_KEYS.forEach(key => delete process.env[key]));
  afterEach(() => {
    vi.unstubAllGlobals();
    ENV_KEYS.forEach(key => delete process.env[key]);
  });

  it('임계값을 넘으면 알림을 남기고, 히스테리시스로 내려오면 해제한다', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    // 첫 평가는 정상값 — 아무 알림도 없다(이후 전이를 첫 로그인처럼 쏟지 않기 위함).
    expect(evaluateAlerts(baseInput(), t0)).toHaveLength(0);

    // CPU 가 90 을 넘으면 warning 이 쌓인다.
    const entered = evaluateAlerts(baseInput({ cpu: 95 }), t0 + 1000);
    expect(entered[0].message).toContain('CPU usage 95%');
    expect(entered[0].level).toBe('warning');

    // 85(=clearBelow 80 보다 큼)에서는 아직 해제되지 않는다.
    const held = evaluateAlerts(baseInput({ cpu: 85 }), t0 + 2000);
    expect(held.find(e => e.message.includes('back to normal'))).toBeUndefined();

    // 80 아래로 내려오면 해제 로그.
    const cleared = evaluateAlerts(baseInput({ cpu: 70 }), t0 + 3000);
    expect(cleared[0].message).toContain('CPU usage back to normal');
    expect(cleared[0].level).toBe('ok');
  });

  it('첫 평가에서 이미 임계 상태면 로그엔 남기되 웹훅은 보내지 않는다', async () => {
    const { evaluateAlerts, fetchMock } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    const first = evaluateAlerts(baseInput({ cpu: 99 }), t0);
    expect(first[0].message).toContain('CPU usage 99%');
    // 부팅 직후 이미 임계였던 값은 외부로 쏟지 않는다.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('전이가 생기면 웹훅으로 통지한다', async () => {
    const { evaluateAlerts, fetchMock } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput(), t0); // 첫 평가 소진
    evaluateAlerts(baseInput({ cpu: 95 }), t0 + 1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/hook');
    expect(JSON.parse((options as RequestInit).body as string).message).toContain('CPU usage 95%');
  });

  it('새 SSH 세션은 통지하고, 이미 있던 세션은 통지하지 않는다', async () => {
    const { evaluateAlerts, fetchMock } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    const existing = { user: 'root', ip: '10.0.0.1', since: new Date(t0).toISOString() };
    // 첫 평가: 이미 붙어 있던 세션은 조용히 기억만.
    evaluateAlerts(baseInput({ sshSessions: [existing] }), t0);
    expect(fetchMock).not.toHaveBeenCalled();

    // 새 세션 등장 → info 알림 + 통지.
    const newSession = { user: 'deploy', ip: '10.0.0.2', since: new Date(t0 + 1000).toISOString() };
    const log = evaluateAlerts(baseInput({ sshSessions: [existing, newSession] }), t0 + 1000);
    expect(log[0].message).toBe('SSH login: deploy@10.0.0.2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('인터페이스 다운/복구 전이를 기록한다', async () => {
    const { evaluateAlerts } = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput({ interfaces: [{ name: 'eth0', state: 'up' }] }), t0);

    const down = evaluateAlerts(baseInput({ interfaces: [{ name: 'eth0', state: 'down' }] }), t0 + 1000);
    expect(down[0].message).toBe('Interface eth0 down');

    const up = evaluateAlerts(baseInput({ interfaces: [{ name: 'eth0', state: 'up' }] }), t0 + 2000);
    expect(up[0].message).toBe('Interface eth0 back up');
  });

  it('임계값을 환경변수로 덮어쓸 수 있다', async () => {
    const { evaluateAlerts } = await freshAlerts({ ALERT_CPU_ENTER: '50', ALERT_CPU_CLEAR: '40' });
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    evaluateAlerts(baseInput(), t0);
    // 기본값이면 60 은 임계가 아니지만, ENTER=50 이므로 알림이 뜬다.
    const entered = evaluateAlerts(baseInput({ cpu: 60 }), t0 + 1000);
    expect(entered[0].message).toContain('CPU usage 60%');
  });

  it('알림 로그를 디스크에 남기고 재시작 후 복구한다', async () => {
    const first = await freshAlerts();
    const t0 = Date.UTC(2026, 0, 2, 12, 0, 0);

    first.evaluateAlerts(baseInput(), t0);
    first.evaluateAlerts(baseInput({ cpu: 95 }), t0 + 1000);

    // 예약 저장을 기다리지 않고 종료 경로와 같은 동기 저장을 태운다.
    process.emit('SIGTERM');

    vi.resetModules();
    process.env.DATA_DIR = first.dir;
    process.env.ALERTS_FILE = first.file;
    const second = await import('@/utils/collectors/alerts');
    // 복구된 로그가 이전 CPU 알림을 포함해야 한다. 정상값으로 한 번 평가해도 유지.
    const log = second.evaluateAlerts(baseInput(), t0 + 2000);
    expect(log.some(e => e.message.includes('CPU usage 95%'))).toBe(true);
  });
});

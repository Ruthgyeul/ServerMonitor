import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// history 는 모듈 스코프에 버킷을 들고 있어서 테스트마다 새로 불러와야 한다.
// 저장 파일도 테스트별 임시 디렉터리로 돌려 서로 간섭하지 않게 한다.
async function freshHistory() {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), 'history-test-'));
  process.env.DATA_DIR = dir;
  process.env.HISTORY_FILE = join(dir, 'history.json');
  const loaded = await import('@/utils/collectors/history');
  return { ...loaded, dir, file: process.env.HISTORY_FILE };
}

const HOUR = 60 * 60 * 1000;

describe('load history buckets', () => {
  beforeEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.HISTORY_FILE;
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.HISTORY_FILE;
  });

  it('48시간을 1시간 버킷 48칸으로 돌려준다', async () => {
    const { recordSample, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(10, 1.5, now);
    const { load } = getHistory(now);

    expect(load).toHaveLength(48);
    // 가장 오래된 칸과 최신 칸이 정확히 47시간 떨어져 있어야 48시간을 덮는다.
    const span = new Date(load.at(-1)!.at).getTime() - new Date(load[0].at).getTime();
    expect(span).toBe(47 * HOUR);
  });

  it('같은 시간대의 샘플은 평균으로 합쳐진다', async () => {
    const { recordSample, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 2, now);
    recordSample(0, 4, now + 60_000);

    expect(getHistory(now).load.at(-1)!.avg1).toBe(3);
  });

  it('서버가 꺼져 있던 구간은 null 로 남는다', async () => {
    const { recordSample, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 1, now - 3 * HOUR);
    recordSample(0, 1, now);

    const { load } = getHistory(now);
    // 최신 칸과 3시간 전 칸에만 값이 있고 그 사이는 비어 있다.
    expect(load.at(-1)!.avg1).toBe(1);
    expect(load.at(-2)!.avg1).toBeNull();
    expect(load.at(-4)!.avg1).toBe(1);
  });

  it('48시간보다 오래된 버킷은 버린다', async () => {
    const { recordSample, getHistory } = await freshHistory();
    const now = Date.UTC(2026, 0, 3, 12, 0, 0);

    recordSample(0, 9, now - 60 * HOUR);
    recordSample(0, 1, now);

    const { load } = getHistory(now);
    expect(load.filter(sample => sample.avg1 === 9)).toHaveLength(0);
  });

  it('재시작해도 디스크에서 복구된다', async () => {
    const first = await freshHistory();
    // 복구는 실제 시계 기준으로 오래된 버킷을 버린다. 고정 과거 시각을 쓰면
    // 저장한 버킷이 곧바로 "48시간 밖" 으로 판정되므로 지금 시각에 맞춘다.
    const now = Math.floor(Date.now() / HOUR) * HOUR;
    first.recordSample(0, 2.5, now);

    // 예약 저장을 기다리지 않고 종료 경로와 같은 동기 저장을 태운다.
    process.emit('SIGTERM');
    const saved = JSON.parse(readFileSync(first.file, 'utf-8'));
    expect(saved.loadBuckets.length).toBeGreaterThan(0);

    // 같은 파일을 가리키는 새 모듈 인스턴스가 값을 다시 읽어야 한다.
    vi.resetModules();
    process.env.DATA_DIR = first.dir;
    process.env.HISTORY_FILE = first.file;
    const second = await import('@/utils/collectors/history');
    expect(second.getHistory(now).load.at(-1)!.avg1).toBe(2.5);
  });

  it('저장 포맷 버전이 다르면 통째로 무시한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-test-'));
    const file = join(dir, 'history.json');
    writeFileSync(file, JSON.stringify({ v: 99, loadBuckets: [[0, 5, 1]], cpuBuckets: [] }));

    vi.resetModules();
    process.env.DATA_DIR = dir;
    process.env.HISTORY_FILE = file;
    const { getHistory } = await import('@/utils/collectors/history');

    const { load } = getHistory(Date.UTC(2026, 0, 2, 12, 0, 0));
    expect(load.every(sample => sample.avg1 === null)).toBe(true);
  });

  it('깨진 파일에도 죽지 않고 빈 상태로 뜬다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-test-'));
    const file = join(dir, 'history.json');
    writeFileSync(file, '{ this is not json');

    vi.resetModules();
    process.env.DATA_DIR = dir;
    process.env.HISTORY_FILE = file;
    const { getHistory } = await import('@/utils/collectors/history');

    expect(() => getHistory(Date.now())).not.toThrow();
  });
});

describe('getLoad30mAverage', () => {
  it('샘플이 없으면 값이 없다고 알린다', async () => {
    const { getLoad30mAverage } = await freshHistory();
    expect(getLoad30mAverage(Date.now())).toEqual({ value: null, windowSeconds: 0 });
  });

  it('창 안의 샘플을 평균낸다', async () => {
    const { recordSample, getLoad30mAverage } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 1, now - 60_000);
    recordSample(0, 3, now);

    expect(getLoad30mAverage(now).value).toBe(2);
  });

  it('창이 덜 찼으면 덮은 구간을 초로 알려준다', async () => {
    const { recordSample, getLoad30mAverage } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 1, now - 90_000);
    recordSample(0, 1, now);

    // 분으로 반올림하면 시작 직후 "0분 평균" 이 되어버린다.
    expect(getLoad30mAverage(now).windowSeconds).toBe(90);
  });

  it('30분보다 오래된 샘플은 평균에서 빠진다', async () => {
    const { recordSample, getLoad30mAverage } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    recordSample(0, 100, now - 31 * 60_000);
    recordSample(0, 2, now);

    const rolling = getLoad30mAverage(now);
    expect(rolling.value).toBe(2);
    expect(rolling.windowSeconds).toBe(0);
  });

  it('창 길이는 30분에서 멈춘다', async () => {
    const { recordSample, getLoad30mAverage } = await freshHistory();
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);

    for (let minute = 30; minute >= 0; minute -= 1) {
      recordSample(0, 1, now - minute * 60_000);
    }

    expect(getLoad30mAverage(now).windowSeconds).toBe(30 * 60);
  });
});

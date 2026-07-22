import { CpuHourSample, HistoryInfo, LoadSample } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// 히스토리는 프로세스 메모리에만 있다. 서버를 재시작하면 비고, 그 구간은
// UI 에서 "데이터 없음" 셀로 보인다. 영속화는 이 대시보드의 목적(현재 상태를
// 벽에 띄우기)에 비해 과하다.
const LOAD_BUCKET_MS = 15 * 60 * 1000;
const LOAD_BUCKETS = 48; // 12시간
const HOUR_BUCKET_MS = 60 * 60 * 1000;
const HOUR_BUCKETS = 24;

interface Bucket {
  sum: number;
  count: number;
}

const loadBuckets = new Map<number, Bucket>();
const cpuBuckets = new Map<number, Bucket>();

function add(buckets: Map<number, Bucket>, key: number, value: number): void {
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.sum += value;
    bucket.count += 1;
  } else {
    buckets.set(key, { sum: value, count: 1 });
  }
}

function prune(buckets: Map<number, Bucket>, oldestKey: number): void {
  for (const key of buckets.keys()) {
    if (key < oldestKey) buckets.delete(key);
  }
}

export function recordSample(cpuUsage: number, load1: number, at: number = Date.now()): void {
  const loadKey = Math.floor(at / LOAD_BUCKET_MS) * LOAD_BUCKET_MS;
  const hourKey = Math.floor(at / HOUR_BUCKET_MS) * HOUR_BUCKET_MS;

  add(loadBuckets, loadKey, load1);
  add(cpuBuckets, hourKey, cpuUsage);

  prune(loadBuckets, loadKey - (LOAD_BUCKETS - 1) * LOAD_BUCKET_MS);
  prune(cpuBuckets, hourKey - (HOUR_BUCKETS - 1) * HOUR_BUCKET_MS);
}

function series(buckets: Map<number, Bucket>, bucketMs: number, count: number, now: number, digits: number) {
  const newestKey = Math.floor(now / bucketMs) * bucketMs;
  return Array.from({ length: count }, (_, index) => {
    const key = newestKey - (count - 1 - index) * bucketMs;
    const bucket = buckets.get(key);
    return {
      at: new Date(key).toISOString(),
      value: bucket ? round(bucket.sum / bucket.count, digits) : null
    };
  });
}

export function getHistory(now: number = Date.now()): HistoryInfo {
  const load: LoadSample[] = series(loadBuckets, LOAD_BUCKET_MS, LOAD_BUCKETS, now, 2).map(
    ({ at, value }) => ({ at, avg1: value })
  );
  const cpuHourly: CpuHourSample[] = series(cpuBuckets, HOUR_BUCKET_MS, HOUR_BUCKETS, now, 1).map(
    ({ at, value }) => ({ at, usage: value })
  );
  return { load, cpuHourly };
}

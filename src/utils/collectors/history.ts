import fs from 'fs';
import path from 'path';

import { CpuHourSample, HistoryInfo, LoadSample } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// 히스토리 버킷은 프로세스 메모리에 두되, 디스크에도 영속화한다. 그래야
// 배포(git pull) 후 재시작이나 크래시로 서버가 다시 떠도 최근 48/24시간 그래프가
// 리셋되지 않는다. 저장 파일은 gitignore 된 data 디렉터리에 있어 pull/build 가
// 건드리지 않는다.
// 로드는 칸 수(48)를 유지한 채 버킷을 1시간으로 넓혀 48시간을 덮는다.
const LOAD_BUCKET_MS = 60 * 60 * 1000;
const LOAD_BUCKETS = 48; // 48시간
const HOUR_BUCKET_MS = 60 * 60 * 1000;
const HOUR_BUCKETS = 24;

// 디스크에 너무 자주 쓰지 않도록 최소 저장 간격을 둔다. 버킷은 작아서(수십 개)
// 손실되는 최악의 구간도 이 간격만큼뿐이다.
const SAVE_INTERVAL_MS = 30 * 1000;

// process.cwd() resolves to the project root at runtime; without this ignore,
// Turbopack's file tracer can't statically scope it and traces the entire
// project into the output bundle (the "unexpected file in NFT list" warning).
const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.HISTORY_FILE || path.join(DATA_DIR, 'history.json');
const STORE_VERSION = 1;

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

// --- 영속화 --------------------------------------------------------------

type SerializedBucket = [key: number, sum: number, count: number];
interface StoreShape {
  v: number;
  loadBuckets: SerializedBucket[];
  cpuBuckets: SerializedBucket[];
}

function serialize(buckets: Map<number, Bucket>): SerializedBucket[] {
  return [...buckets.entries()].map(([key, { sum, count }]) => [key, sum, count]);
}

function hydrate(buckets: Map<number, Bucket>, rows: unknown, bucketMs: number, count: number): void {
  if (!Array.isArray(rows)) return;
  const oldest = Math.floor(Date.now() / bucketMs) * bucketMs - (count - 1) * bucketMs;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) continue;
    const [key, sum, cnt] = row;
    // 손상/오래된 버킷은 조용히 버린다. 화면에 "데이터 없음" 으로 보일 뿐이다.
    if (typeof key !== 'number' || typeof sum !== 'number' || typeof cnt !== 'number') continue;
    if (!Number.isFinite(key) || cnt <= 0 || key < oldest) continue;
    buckets.set(key, { sum, count: cnt });
  }
}

let loaded = false;

// 최초 접근 시 한 번만 디스크에서 읽어들인다. top-level await 를 피하려고
// 동기 읽기를 쓴다(파일이 작아 부담 없다).
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreShape;
    if (parsed && parsed.v === STORE_VERSION) {
      hydrate(loadBuckets, parsed.loadBuckets, LOAD_BUCKET_MS, LOAD_BUCKETS);
      hydrate(cpuBuckets, parsed.cpuBuckets, HOUR_BUCKET_MS, HOUR_BUCKETS);
    }
  } catch {
    // 파일이 없거나(첫 실행) 읽을 수 없으면 빈 상태로 시작한다.
  }
}

let lastSaveAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;

async function writeStore(): Promise<void> {
  if (writing) return;
  writing = true;
  lastSaveAt = Date.now();
  const payload: StoreShape = {
    v: STORE_VERSION,
    loadBuckets: serialize(loadBuckets),
    cpuBuckets: serialize(cpuBuckets)
  };
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    // 임시 파일에 쓰고 rename 해서, 쓰다 만 파일이 남지 않게(원자적 교체) 한다.
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf-8');
    await fs.promises.rename(tmp, STORE_FILE);
  } catch {
    // 디스크 쓰기 실패는 치명적이지 않다. 다음 저장에서 다시 시도한다.
  } finally {
    writing = false;
  }
}

// 매 샘플마다 쓰지 않고, 최소 간격을 두어 예약한다.
function scheduleSave(): void {
  if (saveTimer) return;
  const elapsed = Date.now() - lastSaveAt;
  const delay = Math.max(0, SAVE_INTERVAL_MS - elapsed);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeStore();
  }, delay);
  // 이 타이머 하나 때문에 프로세스가 종료를 미루지 않도록 한다.
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

// 종료 신호를 받으면 마지막 상태를 동기로 한 번 더 남긴다. 예약된 저장이
// 아직 안 돌았어도 최근 구간을 잃지 않는다.
function flushSync(): void {
  try {
    const payload: StoreShape = {
      v: STORE_VERSION,
      loadBuckets: serialize(loadBuckets),
      cpuBuckets: serialize(cpuBuckets)
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload), 'utf-8');
  } catch {
    // 종료 중 실패는 삼킨다.
  }
}

let exitHooked = false;
function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.once('SIGTERM', () => flushSync());
  process.once('SIGINT', () => flushSync());
  process.once('beforeExit', () => flushSync());
}

// --- 공개 API ------------------------------------------------------------

export function recordSample(cpuUsage: number, load1: number, at: number = Date.now()): void {
  ensureLoaded();
  hookExit();

  const loadKey = Math.floor(at / LOAD_BUCKET_MS) * LOAD_BUCKET_MS;
  const hourKey = Math.floor(at / HOUR_BUCKET_MS) * HOUR_BUCKET_MS;

  add(loadBuckets, loadKey, load1);
  add(cpuBuckets, hourKey, cpuUsage);

  prune(loadBuckets, loadKey - (LOAD_BUCKETS - 1) * LOAD_BUCKET_MS);
  prune(cpuBuckets, hourKey - (HOUR_BUCKETS - 1) * HOUR_BUCKET_MS);

  scheduleSave();
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
  ensureLoaded();
  const load: LoadSample[] = series(loadBuckets, LOAD_BUCKET_MS, LOAD_BUCKETS, now, 2).map(
    ({ at, value }) => ({ at, avg1: value })
  );
  const cpuHourly: CpuHourSample[] = series(cpuBuckets, HOUR_BUCKET_MS, HOUR_BUCKETS, now, 1).map(
    ({ at, value }) => ({ at, usage: value })
  );
  return { load, cpuHourly };
}

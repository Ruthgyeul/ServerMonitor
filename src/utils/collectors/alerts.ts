import fs from 'fs';
import path from 'path';

import { AlertEntry, AlertLevel, FirewallInfo, SshSession, TemperatureValue } from '@/types/system';
import { dispatchAlert } from '@/utils/collectors/notify';

const MAX_ENTRIES = 30;

// 임계값은 환경변수로 덮어쓸 수 있게 한다. 미설정이면 아래 기본값을 쓴다 —
// 소스를 고치지 않고도 운영자가 호스트 특성에 맞춰 조정할 수 있어야 한다.
function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

// 임계값을 넘나드는 값 때문에 로그가 도배되지 않도록, 켜지는 값과 꺼지는 값을
// 다르게 둔다(히스테리시스).
interface Rule {
  key: string;
  level: AlertLevel;
  enterAbove: number;
  clearBelow: number;
  onEnter: (value: number) => string;
  onClear: (value: number) => string;
}

const RULES: Rule[] = [
  {
    key: 'cpu',
    level: 'warning',
    enterAbove: num('ALERT_CPU_ENTER', 90),
    clearBelow: num('ALERT_CPU_CLEAR', 80),
    onEnter: value => `CPU usage ${value.toFixed(0)}%`,
    onClear: () => 'CPU usage back to normal'
  },
  {
    key: 'memory',
    level: 'warning',
    enterAbove: num('ALERT_MEM_ENTER', 90),
    clearBelow: num('ALERT_MEM_CLEAR', 80),
    onEnter: value => `Memory usage ${value.toFixed(0)}%`,
    onClear: () => 'Memory usage back to normal'
  },
  {
    key: 'disk',
    level: 'warning',
    enterAbove: num('ALERT_DISK_ENTER', 85),
    clearBelow: num('ALERT_DISK_CLEAR', 80),
    onEnter: value => `Disk usage crossed ${value.toFixed(0)}%`,
    onClear: () => 'Disk usage back to normal'
  },
  {
    key: 'temperature',
    level: 'critical',
    enterAbove: num('ALERT_TEMP_ENTER', 74),
    clearBelow: num('ALERT_TEMP_CLEAR', 70),
    onEnter: value => `CPU temp ${value.toFixed(1)}°C`,
    onClear: () => 'CPU temp back to normal'
  },
  {
    key: 'swap',
    level: 'warning',
    enterAbove: num('ALERT_SWAP_ENTER', 80),
    clearBelow: num('ALERT_SWAP_CLEAR', 60),
    onEnter: value => `Swap usage ${value.toFixed(0)}%`,
    onClear: () => 'Swap usage back to normal'
  }
];

// 임계 상태가 지속될 때 다시 통지할 간격(분). 0(기본)이면 재통지하지 않는다.
// 화면 로그는 도배하지 않고, 외부 웹훅으로만 재통지한다.
const RENOTIFY_MS = num('ALERT_RENOTIFY_MINUTES', 0) * 60 * 1000;

const active = new Set<string>();
const log: AlertEntry[] = [];
let knownSessions: Set<string> | null = null;
let knownFirewall: FirewallInfo['status'] | null = null;
let knownIfaceDown: Set<string> | null = null;
let sequence = 0;
// 룰별 마지막 외부 통지 시각. 재통지 쿨다운 판단에 쓴다.
const lastNotifiedAt = new Map<string, number>();

// --- 디스크 영속화 -------------------------------------------------------
// 알림 로그는 지금까지 프로세스 메모리에만 있어 재시작하면 사라졌다. history.json
// 과 같은 방식으로 data/alerts.json 에 남겨, 배포/크래시 후에도 최근 알림이 유지된다.
const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const STORE_FILE = process.env.ALERTS_FILE || path.join(DATA_DIR, 'alerts.json');
const STORE_VERSION = 1;

interface StoreShape {
  v: number;
  log: AlertEntry[];
}

let loaded = false;
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreShape;
    if (parsed && parsed.v === STORE_VERSION && Array.isArray(parsed.log)) {
      // 최신순으로 저장돼 있으므로 그대로 복원하되 상한을 지킨다.
      for (const entry of parsed.log.slice(0, MAX_ENTRIES)) log.push(entry);
    }
  } catch {
    // 파일이 없거나(첫 실행) 읽을 수 없으면 빈 상태로 시작한다.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;
const SAVE_INTERVAL_MS = 5000;

async function writeStore(): Promise<void> {
  if (writing) return;
  writing = true;
  const payload: StoreShape = { v: STORE_VERSION, log };
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf-8');
    await fs.promises.rename(tmp, STORE_FILE);
  } catch {
    // 디스크 쓰기 실패는 치명적이지 않다. 다음 저장에서 다시 시도한다.
  } finally {
    writing = false;
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeStore();
  }, SAVE_INTERVAL_MS);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

// 종료 신호에 마지막 상태를 동기로 한 번 더 남긴다. 예약 저장이 아직 안 돌았어도
// 최근 알림을 잃지 않는다(history.ts 와 같은 방식).
function flushSync(): void {
  try {
    const payload: StoreShape = { v: STORE_VERSION, log };
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

// --- 로그/통지 -----------------------------------------------------------

// firstEvaluation: 프로세스가 막 떠서 처음 평가하는 순간에는, 이미 임계 상태이거나
// 이미 붙어 있던 SSH/방화벽 상태를 "방금 일어난 일"처럼 외부로 쏟아내지 않는다.
// 화면 로그에는 남기되(운영자가 현재 상태를 알 수 있게) 웹훅 통지는 건너뛴다.
function push(level: AlertLevel, message: string, at: number, notify: boolean): void {
  sequence += 1;
  const entry: AlertEntry = { id: `${at}-${sequence}`, level, message, at: new Date(at).toISOString() };
  log.unshift(entry);
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
  scheduleSave();

  if (notify) void dispatchAlert(entry);
}

export interface AlertInput {
  cpu: number;
  memory: number;
  disk: number;
  swap: number;
  temperature: TemperatureValue;
  firewall: FirewallInfo['status'];
  sshSessions: SshSession[];
  // 인터페이스 다운 감지용. 이름과 상태만 있으면 된다(선택적: 구버전 입력 호환).
  interfaces?: { name: string; state: 'up' | 'down' | 'unknown' }[];
}

export function evaluateAlerts(input: AlertInput, at: number = Date.now()): AlertEntry[] {
  ensureLoaded();
  hookExit();

  const firstEvaluation = knownSessions === null && knownFirewall === null && knownIfaceDown === null;
  const values: Record<string, number | null> = {
    cpu: input.cpu,
    memory: input.memory,
    disk: input.disk,
    swap: input.swap,
    temperature: input.temperature === 'N/A' ? null : input.temperature
  };

  for (const rule of RULES) {
    const value = values[rule.key];
    if (value === null || Number.isNaN(value)) continue;

    if (!active.has(rule.key) && value > rule.enterAbove) {
      active.add(rule.key);
      lastNotifiedAt.set(rule.key, at);
      push(rule.level, rule.onEnter(value), at, !firstEvaluation);
    } else if (active.has(rule.key) && value < rule.clearBelow) {
      active.delete(rule.key);
      lastNotifiedAt.delete(rule.key);
      push('ok', rule.onClear(value), at, !firstEvaluation);
    } else if (active.has(rule.key) && RENOTIFY_MS > 0) {
      // 임계 상태가 지속되면 재통지(외부 웹훅만, 화면 로그는 도배하지 않는다).
      const last = lastNotifiedAt.get(rule.key) ?? 0;
      if (at - last >= RENOTIFY_MS) {
        lastNotifiedAt.set(rule.key, at);
        void dispatchAlert({
          id: `${at}-renotify-${rule.key}`,
          level: rule.level,
          message: `${rule.onEnter(value)} (still)`,
          at: new Date(at).toISOString()
        });
      }
    }
  }

  // 새로 생긴 SSH 세션만 기록한다. 첫 평가에서는 이미 붙어 있던 세션을
  // 방금 로그인한 것처럼 쏟아내지 않도록 조용히 기억만 해둔다.
  // 키는 user@ip 로만 잡는다. `since` 를 넣으면 타임스탬프가 조금만 흔들려도
  // 같은 세션이 새 로그인처럼 반복 기록되므로(도배) 세션 지속 동안은 한 번만 남긴다.
  const sessionKeys = new Set(input.sshSessions.map(s => `${s.user}@${s.ip}`));
  if (knownSessions === null) {
    knownSessions = sessionKeys;
  } else {
    for (const session of input.sshSessions) {
      const key = `${session.user}@${session.ip}`;
      if (!knownSessions.has(key)) push('info', `SSH login: ${session.user}@${session.ip}`, at, true);
    }
    knownSessions = sessionKeys;
  }

  // 인터페이스 다운 전이. up→down 은 경고, down→up 은 해제로 남긴다.
  if (input.interfaces) {
    const downNow = new Set(input.interfaces.filter(i => i.state === 'down').map(i => i.name));
    if (knownIfaceDown === null) {
      knownIfaceDown = downNow;
    } else {
      for (const name of downNow) {
        if (!knownIfaceDown.has(name)) push('warning', `Interface ${name} down`, at, true);
      }
      for (const name of knownIfaceDown) {
        if (!downNow.has(name)) push('ok', `Interface ${name} back up`, at, true);
      }
      knownIfaceDown = downNow;
    }
  } else if (knownIfaceDown === null) {
    // 인터페이스 정보가 아직 없으면 첫 평가 플래그만 소진되지 않도록 빈 집합으로 초기화.
    knownIfaceDown = new Set();
  }

  if (input.firewall !== 'unknown' && input.firewall !== knownFirewall) {
    if (knownFirewall !== null) {
      push(input.firewall === 'active' ? 'ok' : 'critical', `Firewall ${input.firewall}`, at, true);
    }
    knownFirewall = input.firewall;
  }

  return [...log];
}

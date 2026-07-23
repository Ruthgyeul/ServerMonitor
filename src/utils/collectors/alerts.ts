import { AlertEntry, AlertLevel, FirewallInfo, SshSession, TemperatureValue } from '@/types/system';

const MAX_ENTRIES = 30;

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
    enterAbove: 90,
    clearBelow: 80,
    onEnter: value => `CPU usage ${value.toFixed(0)}%`,
    onClear: () => 'CPU usage back to normal'
  },
  {
    key: 'memory',
    level: 'warning',
    enterAbove: 90,
    clearBelow: 80,
    onEnter: value => `Memory usage ${value.toFixed(0)}%`,
    onClear: () => 'Memory usage back to normal'
  },
  {
    key: 'disk',
    level: 'warning',
    enterAbove: 85,
    clearBelow: 80,
    onEnter: value => `Disk usage crossed ${value.toFixed(0)}%`,
    onClear: () => 'Disk usage back to normal'
  },
  {
    key: 'temperature',
    level: 'critical',
    enterAbove: 74,
    clearBelow: 70,
    onEnter: value => `CPU temp ${value.toFixed(1)}°C`,
    onClear: () => 'CPU temp back to normal'
  },
  {
    key: 'swap',
    level: 'warning',
    enterAbove: 80,
    clearBelow: 60,
    onEnter: value => `Swap usage ${value.toFixed(0)}%`,
    onClear: () => 'Swap usage back to normal'
  }
];

const active = new Set<string>();
const log: AlertEntry[] = [];
let knownSessions: Set<string> | null = null;
let knownFirewall: FirewallInfo['status'] | null = null;
let sequence = 0;

function push(level: AlertLevel, message: string, at: number): void {
  sequence += 1;
  log.unshift({ id: `${at}-${sequence}`, level, message, at: new Date(at).toISOString() });
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
}

export interface AlertInput {
  cpu: number;
  memory: number;
  disk: number;
  swap: number;
  temperature: TemperatureValue;
  firewall: FirewallInfo['status'];
  sshSessions: SshSession[];
}

export function evaluateAlerts(input: AlertInput, at: number = Date.now()): AlertEntry[] {
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
      push(rule.level, rule.onEnter(value), at);
    } else if (active.has(rule.key) && value < rule.clearBelow) {
      active.delete(rule.key);
      push('ok', rule.onClear(value), at);
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
      if (!knownSessions.has(key)) push('info', `SSH login: ${session.user}@${session.ip}`, at);
    }
    knownSessions = sessionKeys;
  }

  if (input.firewall !== 'unknown' && input.firewall !== knownFirewall) {
    if (knownFirewall !== null) {
      push(
        input.firewall === 'active' ? 'ok' : 'critical',
        `Firewall ${input.firewall}`,
        at
      );
    }
    knownFirewall = input.firewall;
  }

  return [...log];
}

import { AlertEntry } from '@/types/system';
import { logger } from '@/utils/logger';

// 알림은 지금까지 화면(대시보드 alerts 카드)에만 표시됐다. 벽에 걸어둔 패널을
// 24/7 쳐다보지 않는 한 임계값을 넘겨도 아무도 모른다. 여기서 임계 전이가 생길
// 때마다 외부로 한 번 밀어준다. ALERT_WEBHOOK_URL 이 설정돼 있을 때만 동작하고,
// 미설정이면(기본값) 완전히 무동작이라 기존 배포에 영향이 없다.

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
// json  — AlertEntry 를 그대로 POST (자체 수신기/웹훅 브리지용)
// slack — Slack Incoming Webhook 의 { text } 형태
// discord — Discord Webhook 의 { content } 형태
const WEBHOOK_FORMAT = (process.env.ALERT_WEBHOOK_FORMAT || 'json').toLowerCase();

// 수집 루프는 매초 도는 민감한 경로다. 웹훅이 느리거나 죽어 있어도 루프를
// 붙잡지 않도록 짧게 끊는다(클러스터 fetch 와 같은 방식).
const TIMEOUT_MS = 5000;

// UI 에서 쓰는 레벨을 사람이 읽는 접두사로. Slack/Discord 메시지 앞머리에 붙는다.
const LEVEL_PREFIX: Record<AlertEntry['level'], string> = {
  ok: '✅',
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🚨'
};

function formatPayload(entry: AlertEntry): string {
  const prefix = LEVEL_PREFIX[entry.level] ?? '';
  const host = process.env.NEXT_PUBLIC_SITE_SHORT_NAME || 'ServerMonitor';
  const text = `${prefix} [${host}] ${entry.message}`;

  switch (WEBHOOK_FORMAT) {
    case 'slack':
      return JSON.stringify({ text });
    case 'discord':
      return JSON.stringify({ content: text });
    default:
      return JSON.stringify(entry);
  }
}

/**
 * 새 알림 하나를 설정된 웹훅으로 밀어준다. 발송 여부/성공에 호출부가 기대지
 * 않도록 항상 resolve 하며(실패는 로그만), fire-and-forget 으로 부르면 된다.
 * 스팸 억제(히스테리시스·부팅 직후 무통지)는 호출부(alerts.ts)가 이미 처리한다.
 */
export async function dispatchAlert(entry: AlertEntry): Promise<void> {
  if (!WEBHOOK_URL) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: formatPayload(entry),
      signal: controller.signal
    });
  } catch (error) {
    // 웹훅 실패는 치명적이지 않다. 대시보드/로그에는 알림이 그대로 남는다.
    const message = error instanceof Error ? error.message : String(error);
    logger.error('alerts webhook dispatch failed:', message);
  } finally {
    clearTimeout(timeout);
  }
}

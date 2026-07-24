import { ServerData } from '@/types/system';
import { getSystemInfo } from '@/utils/systemMonitor';

// 요청마다 수집기를 돌리는 대신, 프로세스 안에서 딱 하나의 루프만 돌린다.
// 접속자가 몇 명이든 쉘 프로세스 spawn(sensors/ping/ps/df ...)은 한 번으로
// 고정되고, 각 SSE 연결은 그 결과를 나눠 받기만 한다.
//
// 루프는 구독자가 없어도 멈추지 않는다. 아무도 안 보고 있어도 히스토리(48/24시간
// 그래프)와 임계값 알림은 계속 쌓여야 하기 때문이다("24/7 수집"). 다만 보는 사람이
// 없을 때는 틱 간격을 늘려 부하를 줄인다 — 히스토리 버킷이 1시간 단위라
// 유휴 구간을 촘촘히 샘플링할 이유가 없다.

type Listener = (data: ServerData) => void;

const ACTIVE_TICK_MS = 1000; // 보는 사람이 있을 때: 실시간
const IDLE_TICK_MS = Number(process.env.IDLE_TICK_MS) || 15000; // 아무도 없을 때: 절약

const listeners = new Set<Listener>();
let running = false;
let handle: ReturnType<typeof setTimeout> | null = null;
let lastData: ServerData | null = null;

async function tick(): Promise<void> {
  try {
    const data = await getSystemInfo();
    lastData = data;
    for (const listener of listeners) {
      // 한 구독자의 예외가 다른 구독자에게 번지지 않게 격리한다.
      try {
        listener(data);
      } catch (error) {
        console.error('SSE listener threw:', error);
      }
    }
  } catch (error) {
    // 수집 자체가 실패해도 루프는 살려둔다. 이번 틱만 건너뛰고,
    // 구독자는 마지막으로 받은 값을 그대로 들고 있는다.
    console.error('system collection loop failed:', error);
  }
}

// setInterval 대신 "완료 후 다음 예약" 방식이라, 수집이 간격보다 오래 걸려도
// 요청이 겹쳐 쌓이지 않는다. 간격은 구독자 유무에 따라 매 틱 다시 정한다.
async function loop(): Promise<void> {
  if (!running) return;
  await tick();
  if (!running) return;
  const interval = listeners.size > 0 ? ACTIVE_TICK_MS : IDLE_TICK_MS;
  handle = setTimeout(() => void loop(), interval);
  if (handle && typeof handle.unref === 'function') handle.unref();
}

/**
 * 수집 루프가 돌고 있지 않으면 시작한다. 서버 부팅 시(instrumentation) 한 번,
 * 그리고 첫 구독자가 붙을 때 호출된다. 이미 돌고 있으면 아무 것도 하지 않는다.
 */
export function ensureCollecting(): void {
  if (running) return;
  running = true;
  void loop();
}

/**
 * 시스템 데이터 갱신을 구독한다. 구독 즉시(값이 있으면) 마지막 스냅샷을 한 번
 * 전달하므로, 새 연결이 다음 틱까지 기다리지 않는다. 반환된 함수를 호출하면
 * 구독이 해제된다. 마지막 구독자가 빠져도 수집 루프는 계속 돈다(24/7).
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  ensureCollecting();

  if (lastData) {
    try {
      listener(lastData);
    } catch (error) {
      console.error('SSE listener threw on initial push:', error);
    }
  }

  return () => {
    listeners.delete(listener);
  };
}

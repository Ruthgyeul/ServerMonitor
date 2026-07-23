import { ServerData } from '@/types/system';
import { getSystemInfo } from '@/utils/systemMonitor';

// 요청마다 수집기를 돌리는 대신, 프로세스 안에서 딱 하나의 루프만 돌린다.
// 접속자가 몇 명이든 쉘 프로세스 spawn(sensors/ping/ps/df ...)은 초당 1회로
// 고정되고, 각 SSE 연결은 그 결과를 나눠 받기만 한다.
//
// 구독자가 0명이 되면 루프를 멈춘다. 아무도 안 보는데 서버를 계속 두드릴
// 이유가 없다. 첫 구독자가 붙으면 즉시 다시 시작한다.

type Listener = (data: ServerData) => void;

const TICK_MS = 1000;

const listeners = new Set<Listener>();
let active = false;
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

// setInterval 대신 "완료 후 다음 예약" 방식이라, 수집이 1초보다 오래 걸려도
// 요청이 겹쳐 쌓이지 않는다.
async function loop(): Promise<void> {
  if (!active) return;
  await tick();
  if (active) handle = setTimeout(() => void loop(), TICK_MS);
}

function start(): void {
  if (active) return;
  active = true;
  void loop();
}

function stop(): void {
  active = false;
  if (handle) {
    clearTimeout(handle);
    handle = null;
  }
}

/**
 * 시스템 데이터 갱신을 구독한다. 구독 즉시(값이 있으면) 마지막 스냅샷을 한 번
 * 전달하므로, 새 연결이 다음 틱까지 최대 1초를 기다리지 않는다.
 * 반환된 함수를 호출하면 구독이 해제된다.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();

  if (lastData) {
    try {
      listener(lastData);
    } catch (error) {
      console.error('SSE listener threw on initial push:', error);
    }
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

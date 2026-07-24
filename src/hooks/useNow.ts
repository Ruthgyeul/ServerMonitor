'use client';

import { useCallback, useSyncExternalStore } from 'react';

// 서버 렌더 결과에 시각이 박히면 하이드레이션 불일치가 난다. 서버 스냅샷은 null 로
// 두고(화면은 자리표시자를 그린다) 클라이언트에서만 실제 시각을 흘려보낸다.
//
// effect 안에서 setState 를 부르는 대신 외부 스토어로 구독한다. 그래야 하이드레이션
// 직후 한 번 더 렌더되는 일이 없고, 같은 간격을 쓰는 훅끼리 타이머 하나를 공유한다.

interface Ticker {
  now: number;
  listeners: Set<() => void>;
  handle: ReturnType<typeof setInterval> | null;
}

const tickers = new Map<number, Ticker>();

function tickerFor(intervalMs: number): Ticker {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    ticker = { now: Date.now(), listeners: new Set(), handle: null };
    tickers.set(intervalMs, ticker);
  }
  return ticker;
}

export function useNow(intervalMs = 1000): number | null {
  // 티커는 콜백 안에서만 집는다. 렌더 중에 꺼내 두면 "렌더에서 만든 값을 나중에
  // 수정한다" 로 잡히므로(react-hooks/immutability) 그렇게 하지 않는다.
  const subscribe = useCallback(
    (listener: () => void) => {
      const ticker = tickerFor(intervalMs);

      // 오래 놀던 티커라면 캐시된 시각이 낡았다. 구독 시점에 한 번 맞춰 둔다.
      // React 가 구독 직후 스냅샷을 다시 읽어 달라진 값을 반영한다.
      ticker.now = Date.now();
      ticker.listeners.add(listener);

      // 첫 구독자에서만 타이머를 켜고, 마지막 구독자가 떠나면 끈다.
      if (!ticker.handle) {
        ticker.handle = setInterval(() => {
          ticker.now = Date.now();
          for (const notify of ticker.listeners) notify();
        }, intervalMs);
      }

      return () => {
        ticker.listeners.delete(listener);
        if (ticker.listeners.size === 0 && ticker.handle) {
          clearInterval(ticker.handle);
          ticker.handle = null;
        }
      };
    },
    [intervalMs]
  );

  // getSnapshot 은 값이 안 바뀐 동안 같은 값을 돌려줘야 한다(아니면 무한 렌더).
  // 그래서 Date.now() 를 직접 부르지 않고 티커가 캐시한 값을 읽는다.
  const getSnapshot = useCallback(() => tickerFor(intervalMs).now, [intervalMs]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

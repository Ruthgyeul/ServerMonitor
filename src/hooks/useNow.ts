'use client';

import { useEffect, useState } from 'react';

// 서버 렌더 결과에 시각이 박히면 하이드레이션 불일치가 난다.
// 마운트 전에는 null 을 돌려주고, 화면에서는 자리표시자를 그린다.
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return now;
}

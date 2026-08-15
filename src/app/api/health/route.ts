import os from 'os';
import { NextResponse } from 'next/server';

import { getLoopHealth } from '@/utils/systemStream';

// 가벼운 헬스체크. /api/system 은 SSH IP·프로세스 목록 같은 무거운 정찰 정보를
// 전부 수집하므로 컨테이너 orchestration/uptime 프로브에는 과하다. 이 라우트는
// 수집을 트리거하지 않고 프로세스 생존과 수집 루프의 건강만 즉시 돌려준다.
//
// proxy.ts 의 토큰 게이트는 /api/system* 만 매칭하므로 이 경로는 게이트 밖 —
// 오케스트레이터가 토큰 없이 프로브할 수 있다. 민감 정보는 노출하지 않는다.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const loop = getLoopHealth();

  // 루프가 돌고 있는데도 마지막 틱이 너무 오래됐거나 연속 실패가 쌓이면
  // degraded 로 보고한다(HTTP 는 여전히 200 — 프로브가 프로세스를 죽이지 않도록).
  const stalled = loop.running && loop.lastTickAgeMs !== null && loop.lastTickAgeMs > 60_000;
  const failing = loop.consecutiveFailures >= 5;
  const status = stalled || failing ? 'degraded' : 'ok';

  return NextResponse.json(
    {
      status,
      uptime: Math.floor(os.uptime()),
      loop,
      timestamp: new Date().toISOString()
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

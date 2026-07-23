import { NextRequest, NextResponse } from 'next/server';

// /api/system* 는 SSH 접속 IP/사용자명, 전체 프로세스 목록, 열린 포트, 트래픽
// 상대 IP, 방화벽 상태 같은 민감한 정찰 정보를 돌려준다. CORS 는 브라우저의
// 교차 출처 "읽기"만 막을 뿐, curl 같은 비-브라우저 클라이언트는 그대로 읽는다.
//
// 그래서 선택적 공유 토큰 게이트를 둔다. API_AUTH_TOKEN 이 설정돼 있으면 모든
// /api/system* 요청은 그 토큰을 제시해야 한다. 설정돼 있지 않으면(기본값)
// 동작은 이전과 완전히 동일하다 — 대신 네트워크 레벨(로컬바인딩/VPN/리버스
// 프록시)로 보호해야 한다(README 참고).
//
// 주의: 토큰을 켜면 브라우저 내장 대시보드(같은 오리진에서 /api/system/stream 을
// 부른다)는 토큰을 실을 수 없어 동작하지 않는다. 이 모드는 리버스 프록시가
// 토큰을 주입하거나, 머신-투-머신 폴링을 하는 배포를 위한 것이다.

const AUTH_TOKEN = process.env.API_AUTH_TOKEN;

// 길이가 다르거나 값이 다를 때 걸리는 시간을 최대한 균일하게 만들어
// 타이밍 사이드채널로 토큰을 한 글자씩 알아내는 것을 어렵게 한다.
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  // 길이가 달라도 동일한 바이트 수를 비교하도록 긴 쪽 기준으로 순회한다.
  const length = Math.max(aBytes.length, bBytes.length);
  let mismatch = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return mismatch === 0;
}

function presentedToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  // EventSource 는 커스텀 헤더를 못 붙이므로 쿠키 경로도 허용한다(프록시가 주입).
  const cookie = request.cookies.get('api_auth_token')?.value;
  return cookie ?? null;
}

export function proxy(request: NextRequest) {
  // 토큰이 설정돼 있지 않으면 게이트를 열어둔다(기존 동작 유지).
  if (!AUTH_TOKEN) return NextResponse.next();

  // preflight 는 인증 대상이 아니다. 실제 요청에서 검사한다.
  if (request.method === 'OPTIONS') return NextResponse.next();

  const token = presentedToken(request);
  if (token && timingSafeEqual(token, AUTH_TOKEN)) {
    return NextResponse.next();
  }

  return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer'
    }
  });
}

export const config = {
  matcher: ['/api/system', '/api/system/:path*']
};

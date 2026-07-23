import type { NextConfig } from "next";

// 보안 응답 헤더. 대시보드는 임베드될 이유가 없으므로 클릭재킹을 원천 차단하고,
// MIME 스니핑/플러그인 주입/base 태그 하이재킹을 막는다.
//
// CSP 는 script/style/connect 를 제약하지 않는 최소 구성이다. 그 세 가지를
// 좁히면 Next 의 인라인 부트스트랩, Tailwind/Recharts 의 인라인 스타일,
// /cluster 의 교차-노드 fetch 가 깨지기 쉬워, 여기서는 확실히 안전한
// frame-ancestors/object-src/base-uri 만 강제한다. 더 엄격한 CSP 가 필요하면
// 배포 환경에 맞춰 script-src/connect-src 를 추가하라(README 참고).
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 이 대시보드는 카메라/마이크/위치정보 등을 쓰지 않는다. 전부 끈다.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  },
  // HTTPS 응답에서만 브라우저가 적용한다. HTTP 로 서빙 중이면 무시되므로 안전.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains"
  }
];

const nextConfig: NextConfig = {
  poweredByHeader: false, // "X-Powered-By: Next.js" 로 스택/버전을 광고하지 않는다
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;

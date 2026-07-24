// /api/system 과 /api/system/stream 이 같은 규칙으로 CORS 를 다루도록 한곳에 모은다.

// .env 의 ALLOWED_ORIGINS(콤마 구분). 뒤에 붙은 슬래시는 Origin 헤더에 없으므로 떼어낸다.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export function isAllowedOrigin(origin: string | undefined): origin is string {
  return Boolean(origin) && allowedOrigins.includes(origin as string);
}

// 응답의 Access-Control-Allow-Origin 이 요청 Origin 에 따라 달라지므로 Vary: Origin 이
// 반드시 필요하다. 없으면 앞단 캐시(리버스 프록시/CDN)가 A 오리진에 내준 응답을
// B 오리진에 그대로 재사용해, 허용되지 않은 오리진이 읽어 가거나 그 반대가 된다.
// 오리진이 허용되지 않아 ACAO 를 안 붙이는 경우에도 응답은 Origin 에 의존하므로
// 항상 붙인다.
export function corsHeaders(origin: string | undefined, base: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...base, Vary: 'Origin' };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

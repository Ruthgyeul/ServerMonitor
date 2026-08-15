// Centralized so /api/system and /api/system/stream handle CORS by the same rules.

// ALLOWED_ORIGINS from .env (comma-separated). A trailing slash isn't in the Origin header, so strip it.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export function isAllowedOrigin(origin: string | undefined): origin is string {
  return Boolean(origin) && allowedOrigins.includes(origin as string);
}

// The response's Access-Control-Allow-Origin varies by the request Origin, so
// Vary: Origin is required. Without it an upstream cache (reverse proxy/CDN)
// would reuse the response served to origin A for origin B, letting a
// disallowed origin read it or vice versa. Even when the origin isn't allowed
// and ACAO isn't attached, the response still depends on Origin, so always attach it.
export function corsHeaders(
  origin: string | undefined,
  base: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = { ...base, Vary: 'Origin' };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

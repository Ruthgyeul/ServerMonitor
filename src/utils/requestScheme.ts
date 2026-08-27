// Whether the request reached us over HTTPS, judged from the externally observed
// scheme rather than NODE_ENV. A production build served over plain HTTP on a LAN
// (e.g. the Docker deployment at http://host:3000) must NOT get a Secure cookie,
// or the browser drops it and the login loops. Behind a TLS-terminating proxy,
// x-forwarded-proto carries the real scheme.
export function isHttps(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

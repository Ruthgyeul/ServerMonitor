// CSRF guard for state-changing routes. The dashboard authenticates with a
// cookie, so a page on another site could otherwise make the browser POST to
// these endpoints with the user's session. Browsers always label such requests
// (Sec-Fetch-Site, Origin); non-browser clients (curl, scripts) send neither and
// are still subject to requireApiAuth.

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export function isCrossSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;

  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return host === null || hostOf(origin) !== host;
}

// Returns a 403 Response for a cross-site request, or null to proceed.
export function rejectCrossSite(request: Request): Response | null {
  if (!isCrossSiteRequest(request)) return null;
  return new Response(JSON.stringify({ success: false, error: 'Cross-site request refused' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

// Next does not automatically compress the Response a route handler returns.
// The /api/system payload reaches tens of KB with history + processes and the
// cluster polls it every second, so compress it only when the client says it
// accepts gzip.
//
// Do NOT use this for streaming (SSE): that keeps the connection open and
// streams as it goes, so compression breaks its real-time behaviour. This
// helper is for complete JSON bodies only.
export async function jsonResponse(
  request: Request,
  payload: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // The same URL returns different bodies depending on Accept-Encoding, so
    // keep caches from mixing them up.
    Vary: mergeVary(init.headers?.['Vary'], 'Accept-Encoding'),
    ...init.headers
  };
  // ...init.headers above can overwrite Vary, so set the merged value again.
  headers['Vary'] = mergeVary(init.headers?.['Vary'], 'Accept-Encoding');

  const accepts = (request.headers.get('accept-encoding') || '').toLowerCase().includes('gzip');
  // Very small bodies gain nothing from compression (the header/CPU overhead costs more).
  if (accepts && body.length > 1024) {
    const compressed = await gzipAsync(body);
    return new Response(compressed, {
      status: init.status ?? 200,
      headers: { ...headers, 'Content-Encoding': 'gzip' }
    });
  }

  return new Response(body, { status: init.status ?? 200, headers });
}

function mergeVary(existing: string | undefined, add: string): string {
  const parts = new Set(
    (existing ?? '')
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
  );
  parts.add(add);
  return [...parts].join(', ');
}

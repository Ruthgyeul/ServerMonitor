import { NextResponse } from 'next/server';
import { corsHeaders } from '@/utils/cors';
import { getSystemInfo } from '@/utils/systemMonitor';
import { isValidServerData } from '@/utils/validation';
import { logger } from '@/utils/logger';
import { jsonResponse } from '@/utils/http';

// Per-collector failures are each handled with a fallback inside systemMonitor,
// so an error that reaches here is a real fault. Returning a zero-filled "ok"
// response would just show "everything is 0" on the dashboard and hide the
// cause, so we surface it as a 5xx instead.

function getCorsHeaders(origin: string | undefined) {
  // This route only implements GET/OPTIONS. Don't advertise methods/headers it doesn't use.
  return corsHeaders(origin, {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin') || undefined;

  try {
    const data = await getSystemInfo();

    // Validate the data
    if (!data || !isValidServerData(data)) {
      logger.error('Invalid server data received');
      return new NextResponse(JSON.stringify({ error: 'Invalid server data received' }), {
        status: 500,
        headers: getCorsHeaders(origin)
      });
    }

    // Large JSON (history + processes), so compress it when the client accepts gzip.
    return jsonResponse(request, data, { headers: getCorsHeaders(origin) });
  } catch (error) {
    // Keep the cause (file paths / command failure messages) in the server log
    // only, and return the client a generic message that reveals no internals.
    logger.error('Error fetching system data:', error);
    return new NextResponse(JSON.stringify({ error: 'Failed to collect system data' }), {
      status: 500,
      headers: getCorsHeaders(origin)
    });
  }
}

// OPTIONS handling (CORS preflight)
export function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') || undefined;
  return new NextResponse(null, { headers: getCorsHeaders(origin) });
}

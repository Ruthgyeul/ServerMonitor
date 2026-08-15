import { ServerData } from '@/types/system';
import { corsHeaders } from '@/utils/cors';
import { subscribe } from '@/utils/systemStream';

// This route is an SSE stream: the server holds the connection open and pushes
// data. Unlike polling, only one connection per client is kept, and the actual
// collection is handled by systemStream's single loop (fixed at once per second).

// Long-lived connection + Node-only collection (fs/os/child_process), so disable static optimization.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Periodic keep-alive so idle connections aren't dropped by a proxy/firewall.
const KEEPALIVE_MS = 15000;

export async function GET(request: Request) {
  const origin = request.headers.get('origin') || undefined;
  const encoder = new TextEncoder();

  let unsubscribe: () => void = () => {};
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (client left). abort/cancel handle cleanup.
        }
      };

      // Attach an id to each event and give a reconnect-delay (retry) hint at
      // the start. EventSource sends the id back as Last-Event-ID on reconnect,
      // and retry sets the browser's default reconnect interval so recovery
      // after a drop is predictable.
      const send = (data: ServerData) => {
        const id = data.timestamp ?? new Date().toISOString();
        push(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      push('retry: 3000\n\n');
      unsubscribe = subscribe(send);

      // A line starting with ": " is an SSE comment the client ignores. Used to keep the connection alive.
      keepAlive = setInterval(() => push(': ping\n\n'), KEEPALIVE_MS);

      const cleanup = () => {
        unsubscribe();
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
        try {
          controller.close();
        } catch {
          // Ignore if already closed.
        }
      };

      request.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      unsubscribe();
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
    }
  });

  const headers = corsHeaders(origin, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops an nginx reverse proxy from buffering the response and breaking real-time delivery.
    'X-Accel-Buffering': 'no'
  });

  return new Response(stream, { headers });
}

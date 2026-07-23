import { ServerData } from '@/types/system';
import { subscribe } from '@/utils/systemStream';

// 이 라우트는 연결을 열어둔 채 서버가 데이터를 밀어주는 SSE 스트림이다.
// 폴링과 달리 클라이언트당 연결 1개만 유지되고, 실제 수집은 systemStream 의
// 단일 루프가 담당한다(초당 1회 고정).

// 장기 연결 + Node 전용 수집(fs/os/child_process)이므로 정적 최적화를 끈다.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

// 유휴 연결이 프록시/방화벽에 끊기지 않도록 주기적으로 보내는 keep-alive.
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
                    // 컨트롤러가 이미 닫힘(클라이언트 종료). 정리는 abort/cancel 이 맡는다.
                }
            };

            const send = (data: ServerData) => push(`data: ${JSON.stringify(data)}\n\n`);

            unsubscribe = subscribe(send);

            // ": " 로 시작하는 줄은 SSE 코멘트라 클라이언트가 무시한다. 연결 유지용.
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
                    // 이미 닫힌 경우 무시.
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

    const headers: Record<string, string> = {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // nginx 리버스 프록시가 응답을 버퍼링해 실시간성이 깨지는 것을 막는다.
        'X-Accel-Buffering': 'no'
    };
    if (origin && allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }

    return new Response(stream, { headers });
}

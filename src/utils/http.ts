import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

// Next 는 라우트 핸들러가 돌려주는 Response 를 자동으로 압축하지 않는다.
// /api/system 응답은 history + processes 로 수십 KB 에 이르고 클러스터가 매초
// 폴링하므로, 클라이언트가 gzip 을 받는다고 알릴 때만 압축해서 돌려준다.
//
// 스트리밍(SSE)에는 쓰면 안 된다 — 그쪽은 연결을 열어둔 채 흘려보내므로 압축이
// 실시간성을 깨뜨린다. 이 헬퍼는 완결된 JSON 바디에만 쓴다.
export async function jsonResponse(
  request: Request,
  payload: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // 같은 URL 이 Accept-Encoding 에 따라 다른 바디를 내므로 캐시가 섞이지 않게 한다.
    Vary: mergeVary(init.headers?.['Vary'], 'Accept-Encoding'),
    ...init.headers
  };
  // 위에서 ...init.headers 가 Vary 를 덮으므로, 병합한 값을 다시 확정한다.
  headers['Vary'] = mergeVary(init.headers?.['Vary'], 'Accept-Encoding');

  const accepts = (request.headers.get('accept-encoding') || '').toLowerCase().includes('gzip');
  // 아주 작은 바디는 압축 이득이 없다(헤더/CPU 오버헤드가 더 크다).
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

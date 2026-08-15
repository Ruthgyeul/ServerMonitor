import { NextResponse } from 'next/server';

import { ServerData } from '@/types/system';
import {
  ClusterServer,
  getClusterHost,
  getClusterServers,
  getClusterUrl
} from '@/config/clusterConfig';

// 클러스터 뷰는 지금까지 브라우저에서 각 노드의 /api/system 을 직접 폴링했다.
// 그래서 (a) 모든 노드가 대시보드 오리진을 CORS 로 허용해야 하고, (b) 노드 IP 가
// 클라이언트 번들에 그대로 노출되며, (c) 뷰어 수만큼 노드 부하가 중복됐다.
//
// 이 라우트가 서버측에서 노드들을 대신 폴링해 압축 결과만 돌려준다. 브라우저는
// 같은 오리진 한 곳만 부르면 되고, 노드 IP 는 서버에만 남는다.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 응답 없는 노드가 집계 전체를 붙잡지 않도록 노드별로 끊는다.
const FETCH_TIMEOUT_MS = 5000;

type NodeResult =
  | { ok: true; data: ServerData }
  | { ok: false; error: string };

export interface ClusterNode {
  name: string;
  host: string;
  type: ClusterServer['type'];
  result: NodeResult;
}

async function fetchNode(server: ClusterServer): Promise<ClusterNode> {
  const url = getClusterUrl(server, '/api/system');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // 노드에 API_AUTH_TOKEN 게이트가 켜져 있으면 서버가 대신 토큰을 실어 준다
  // (브라우저는 실을 수 없던 값). 미설정이면 헤더를 붙이지 않는다.
  const headers: Record<string, string> = {};
  if (process.env.API_AUTH_TOKEN) headers.Authorization = `Bearer ${process.env.API_AUTH_TOKEN}`;

  try {
    const response = await fetch(url, { signal: controller.signal, headers, cache: 'no-store' });
    if (!response.ok) {
      return { name: server.name, host: getClusterHost(server), type: server.type, result: { ok: false, error: `HTTP ${response.status}` } };
    }
    const data = (await response.json()) as ServerData;
    return { name: server.name, host: getClusterHost(server), type: server.type, result: { ok: true, data } };
  } catch {
    return { name: server.name, host: getClusterHost(server), type: server.type, result: { ok: false, error: 'Connection failed' } };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const servers = getClusterServers();
  const nodes = await Promise.all(servers.map(fetchNode));

  return NextResponse.json(
    { nodes, timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

import { ServerData } from '@/types/system';
import { ClusterServer, getClusterHost, getClusterServers, getClusterUrl } from '@/config/clusterConfig';
import { jsonResponse } from '@/utils/http';
import { expectedSessionToken, requireApiAuth } from '@/utils/apiAuth';

// Until now the cluster view polled each node's /api/system directly from the
// browser. That meant (a) every node had to CORS-allow the dashboard origin,
// (b) node IPs were exposed in the client bundle, and (c) node load was
// duplicated per viewer.
//
// This route polls the nodes server-side instead and returns a compact result.
// The browser calls one same-origin endpoint, and node IPs stay server-side.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cap each node so an unresponsive one doesn't hold up the whole aggregation.
const FETCH_TIMEOUT_MS = 5000;

type NodeResult = { ok: true; data: ServerData } | { ok: false; error: string };

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

  // If a node has an auth gate enabled, the server attaches the shared token on
  // its behalf (something the browser couldn't do). This is the same token the
  // local gate expects — the raw API_AUTH_TOKEN when set, otherwise the token
  // derived from a shared DASHBOARD_PASSWORD. If the gate is off, no header is added.
  const headers: Record<string, string> = {};
  const token = expectedSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(url, { signal: controller.signal, headers, cache: 'no-store' });
    if (!response.ok) {
      return {
        name: server.name,
        host: getClusterHost(server),
        type: server.type,
        result: { ok: false, error: `HTTP ${response.status}` }
      };
    }
    const data = (await response.json()) as ServerData;
    return { name: server.name, host: getClusterHost(server), type: server.type, result: { ok: true, data } };
  } catch {
    return {
      name: server.name,
      host: getClusterHost(server),
      type: server.type,
      result: { ok: false, error: 'Connection failed' }
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  const servers = getClusterServers();
  const nodes = await Promise.all(servers.map(fetchNode));

  // Large payload aggregating every node's data, so compress it when gzip is accepted.
  return jsonResponse(
    request,
    { nodes, timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

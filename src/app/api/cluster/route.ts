import { ServerData } from '@/types/system';
import { ClusterServer, getClusterHost, getClusterServers, getClusterUrl } from '@/config/clusterConfig';
import { jsonResponse } from '@/utils/http';
import { expectedSessionToken, requireApiAuth } from '@/utils/apiAuth';
import { enforceRateLimit } from '@/utils/rateLimit';
import { errorCode, nodeMemory, recordNodeOk, type NetPoint } from '@/utils/collectors/clusterState';

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
  // Round trip from this dashboard to the node, in ms (null when it didn't answer).
  rttMs: number | null;
  // When the node last answered (ISO 8601), kept server-side across requests.
  lastOkAt: string | null;
  // The node's recent download/upload rates, oldest first (up to 30 points).
  net: NetPoint[];
}

function withMemory(server: ClusterServer, result: NodeResult, rttMs: number | null): ClusterNode {
  const memory =
    result.ok && rttMs !== null
      ? recordNodeOk(server.name, result.data.network?.download ?? 0, result.data.network?.upload ?? 0)
      : nodeMemory(server.name);
  return {
    name: server.name,
    host: getClusterHost(server),
    type: server.type,
    result,
    rttMs,
    lastOkAt: memory.lastOkAt === null ? null : new Date(memory.lastOkAt).toISOString(),
    net: memory.net
  };
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

  const started = performance.now();
  try {
    const response = await fetch(url, { signal: controller.signal, headers, cache: 'no-store' });
    // Time to the response headers: the network round trip plus the node's own handling.
    const rttMs = Math.round(performance.now() - started);
    if (!response.ok) return withMemory(server, { ok: false, error: `HTTP ${response.status}` }, null);
    const data = (await response.json()) as ServerData;
    return withMemory(server, { ok: true, data }, rttMs);
  } catch (error) {
    return withMemory(server, { ok: false, error: errorCode(error) }, null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const unauthorized = requireApiAuth(request);
  if (unauthorized) return unauthorized;

  // Unlike /api/system, an unlimited caller here doesn't just spin this
  // process — it fans out a request to every cluster node per hit, so a busy
  // loop is amplified across the whole fleet (including the Pis).
  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const servers = getClusterServers();
  const nodes = await Promise.all(servers.map(fetchNode));

  // Large payload aggregating every node's data, so compress it when gzip is accepted.
  return jsonResponse(
    request,
    { nodes, timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

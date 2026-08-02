// Cluster dashboard server list, sourced from NEXT_PUBLIC_CLUSTER_SERVERS so
// adding/removing/reassigning nodes never requires touching code.

export interface ClusterServer {
    name: string;
    ip: string;
    type: 'intel' | 'rpi';
}

export const CLUSTER_PORT = process.env.NEXT_PUBLIC_CLUSTER_PORT || '3000';

// Configurable so dashboards served over HTTPS can point at nodes that also
// terminate TLS, avoiding mixed-content blocks on an all-http default.
export const CLUSTER_PROTOCOL = process.env.NEXT_PUBLIC_CLUSTER_PROTOCOL || 'http';

// A node's `ip` may be a full base URL (e.g. "https://status.example.com",
// possibly behind a reverse proxy) or a bare host/IP. Only the former carries
// its own scheme.
function hasScheme(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

// Base URL for a node, without a trailing slash. If `ip` already includes a
// scheme it is taken as-is (the port lives in the URL, not CLUSTER_PORT); a
// bare host is expanded with the configured protocol and port.
export function getClusterBaseUrl(server: ClusterServer): string {
    const base = hasScheme(server.ip)
        ? server.ip
        : `${CLUSTER_PROTOCOL}://${server.ip}:${CLUSTER_PORT}`;
    return base.replace(/\/+$/, '');
}

// Full URL for one of a node's endpoints. Callers hardcode only the path
// (e.g. "/api/system"); the host/scheme/port come from the node's `ip`.
export function getClusterUrl(server: ClusterServer, path: string): string {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${getClusterBaseUrl(server)}${suffix}`;
}

// Host shown on the node card. For a full URL this is the hostname (dropping
// scheme/port/path); for a bare host it's the value up to any ":port".
export function getClusterHost(server: ClusterServer): string {
    if (hasScheme(server.ip)) {
        try {
            return new URL(server.ip).hostname;
        } catch {
            return server.ip;
        }
    }
    return server.ip.split(':')[0];
}

function isClusterServer(value: unknown): value is ClusterServer {
    if (!value || typeof value !== 'object') return false;
    const server = value as Record<string, unknown>;
    return (
        typeof server.name === 'string' &&
        typeof server.ip === 'string' &&
        (server.type === 'intel' || server.type === 'rpi')
    );
}

export function getClusterServers(): ClusterServer[] {
    const raw = process.env.NEXT_PUBLIC_CLUSTER_SERVERS;
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isClusterServer);
    } catch (error) {
        console.error('Invalid NEXT_PUBLIC_CLUSTER_SERVERS value:', error);
        return [];
    }
}

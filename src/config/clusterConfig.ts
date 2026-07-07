// Cluster dashboard server list, sourced from NEXT_PUBLIC_CLUSTER_SERVERS so
// adding/removing/reassigning nodes never requires touching code.

export interface ClusterServer {
    name: string;
    ip: string;
    type: 'intel' | 'rpi';
}

export const CLUSTER_PORT = process.env.NEXT_PUBLIC_CLUSTER_PORT || '3000';

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

import { ServerData } from '@/types/system';

export function isValidServerData(data: unknown): data is ServerData {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;

    return (
        d.cpu !== null &&
        typeof d.cpu === 'object' &&
        d.memory !== null &&
        typeof d.memory === 'object' &&
        d.disk !== null &&
        typeof d.disk === 'object' &&
        d.network !== null &&
        typeof d.network === 'object' &&
        d.uptime !== null &&
        typeof d.uptime === 'object' &&
        d.temperature !== null &&
        typeof d.temperature === 'object' &&
        d.fan !== null &&
        typeof d.fan === 'object' &&
        Array.isArray(d.processes)
    );
} 
import { DockerContainer, DockerInfo } from '@/types/system';
import { round, run, withTtl } from '@/utils/collectors/shell';

// Docker container monitoring. Follows the same shape as gpu.ts (nvidia-smi):
// shell out to the `docker` CLI, cache behind a TTL so the 1s dashboard loop
// doesn't spawn a process every tick, and degrade to "unavailable" — not an
// error — when docker isn't installed or the daemon/socket can't be reached,
// which is the normal case on a non-container host.
//
// Containerised deployments need the docker CLI in the image plus the daemon
// socket mounted (see docker-compose.yml); bare-metal installs already have
// both. Set DOCKER_DISABLED=1 to skip the probe entirely.

const UNAVAILABLE: DockerInfo = {
  available: false,
  running: 0,
  total: 0,
  netRxRate: 0,
  netTxRate: 0,
  containers: []
};

// Cap the returned list so a host running dozens of containers can't bloat the
// /api/system payload. running/total still count every container.
const MAX_CONTAINERS = 20;

// `docker stats` samples internally and can take a couple of seconds on a busy
// host, so give it a longer leash than the default 5s run() timeout.
const STATS_TIMEOUT_MS = 8000;

// Docker prints byte sizes in two unit families: memory uses binary units
// (KiB/MiB/GiB, 1024-based) while network/block I/O use decimal SI units
// (kB/MB/GB, 1000-based). "0B" / plain "B" is one byte. Parse both families.
const UNIT_FACTORS: Record<string, number> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  PB: 1e15,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
  PiB: 1024 ** 5
};

export function parseDockerBytes(text: string): number | null {
  const match = text.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const factor = UNIT_FACTORS[match[2]];
  if (Number.isNaN(value) || factor === undefined) return null;
  return value * factor;
}

// "128.4MiB / 1.943GiB" → [used, limit]. Either side may be unparseable.
function parsePair(text: string): [number | null, number | null] {
  const parts = text.split('/');
  if (parts.length !== 2) return [null, null];
  return [parseDockerBytes(parts[0]), parseDockerBytes(parts[1])];
}

// "12.34%" → 12.34. null when the value is absent/unparseable.
function parsePercent(text: string): number | null {
  const value = parseFloat(text.replace('%', '').trim());
  return Number.isNaN(value) ? null : round(value, 2);
}

// `docker ps -a --format "{{json .}}"` row (the fields we read).
interface PsRow {
  ID?: string;
  Names?: string;
  Image?: string;
  State?: string;
  Status?: string;
}

// `docker stats --no-stream --format "{{json .}}"` row.
interface StatsRow {
  ID?: string;
  Container?: string;
  CPUPerc?: string;
  MemUsage?: string;
  MemPerc?: string;
  NetIO?: string;
  BlockIO?: string;
}

// Both commands emit one JSON object per line. Skip blank/malformed lines
// rather than failing the whole read.
export function parseJsonLines<T>(stdout: string): T[] {
  const rows: T[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // ignore a malformed line
    }
  }
  return rows;
}

interface NetSample {
  rx: number;
  tx: number;
  at: number;
}

// Previous cumulative NetIO counters per container id, so a rate (KB/s) can be
// computed from the delta — the same technique as the host network/diskio
// collectors. Module-level so it survives across the TTL refreshes.
let prevSamples = new Map<string, NetSample>();

interface BuildResult {
  containers: DockerContainer[];
  running: number;
  total: number;
  netRxRate: number;
  netTxRate: number;
  samples: Map<string, NetSample>;
}

// Pure merge of `docker ps` (the full roster + state) and `docker stats` (live
// usage for running containers), plus per-container network-rate computation.
// Split from the command execution so the parsing/rate maths can be unit-tested.
export function buildContainers(
  psRows: PsRow[],
  statsRows: StatsRow[],
  prev: Map<string, NetSample>,
  now: number
): BuildResult {
  const statsById = new Map<string, StatsRow>();
  for (const row of statsRows) {
    const id = (row.ID || row.Container || '').slice(0, 12);
    if (id) statsById.set(id, row);
  }

  const samples = new Map<string, NetSample>();
  let netRxRate = 0;
  let netTxRate = 0;
  let running = 0;

  const containers = psRows.map((ps): DockerContainer => {
    const id = (ps.ID || '').slice(0, 12);
    const state = (ps.State || 'unknown').toLowerCase();
    if (state === 'running') running += 1;

    const stats = statsById.get(id);
    const [memUsed, memLimit] = stats ? parsePair(stats.MemUsage ?? '') : [null, null];
    const [netRx, netTx] = stats ? parsePair(stats.NetIO ?? '') : [null, null];
    const [blkRead, blkWrite] = stats ? parsePair(stats.BlockIO ?? '') : [null, null];

    let netRxRateValue: number | null = null;
    let netTxRateValue: number | null = null;
    if (netRx !== null && netTx !== null) {
      samples.set(id, { rx: netRx, tx: netTx, at: now });
      const before = prev.get(id);
      if (before) {
        const elapsed = (now - before.at) / 1000;
        if (elapsed > 0) {
          // A container restart resets its counters; clamp a negative delta to 0.
          netRxRateValue = round(Math.max(0, netRx - before.rx) / 1024 / elapsed);
          netTxRateValue = round(Math.max(0, netTx - before.tx) / 1024 / elapsed);
          netRxRate += netRxRateValue;
          netTxRate += netTxRateValue;
        }
      }
    }

    return {
      id,
      name: (ps.Names || '').split(',')[0] || id,
      image: ps.Image || '',
      state,
      status: ps.Status || '',
      cpuPercent: stats ? parsePercent(stats.CPUPerc ?? '') : null,
      memUsedMb: memUsed === null ? null : round(memUsed / (1024 * 1024), 1),
      memLimitMb: memLimit === null ? null : round(memLimit / (1024 * 1024), 1),
      memPercent: stats ? parsePercent(stats.MemPerc ?? '') : null,
      netRxBytes: netRx,
      netTxBytes: netTx,
      netRxRate: netRxRateValue,
      netTxRate: netTxRateValue,
      blockReadBytes: blkRead,
      blockWriteBytes: blkWrite
    };
  });

  // Running first, then heaviest CPU, so the display cap keeps the interesting ones.
  containers.sort((a, b) => {
    if ((a.state === 'running') !== (b.state === 'running')) return a.state === 'running' ? -1 : 1;
    return (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1);
  });

  return {
    containers: containers.slice(0, MAX_CONTAINERS),
    running,
    total: psRows.length,
    netRxRate: round(netRxRate),
    netTxRate: round(netTxRate),
    samples
  };
}

const collectDocker = withTtl(4000, async (): Promise<DockerInfo> => {
  if (/^(1|true)$/i.test(process.env.DOCKER_DISABLED ?? '')) return UNAVAILABLE;

  let psOut: string;
  try {
    psOut = await run('docker ps -a --format "{{json .}}" 2>/dev/null');
  } catch {
    // docker not installed, daemon down, or no socket permission — not an error.
    return UNAVAILABLE;
  }

  const psRows = parseJsonLines<PsRow>(psOut);

  let statsRows: StatsRow[] = [];
  try {
    const statsOut = await run('docker stats --no-stream --format "{{json .}}" 2>/dev/null', STATS_TIMEOUT_MS);
    statsRows = parseJsonLines<StatsRow>(statsOut);
  } catch {
    // stats can time out on a busy host; still show the roster from `docker ps`.
  }

  const result = buildContainers(psRows, statsRows, prevSamples, Date.now());
  prevSamples = result.samples;

  return {
    available: true,
    running: result.running,
    total: result.total,
    netRxRate: result.netRxRate,
    netTxRate: result.netTxRate,
    containers: result.containers
  };
});

export async function getDockerInfo(): Promise<DockerInfo> {
  return collectDocker();
}

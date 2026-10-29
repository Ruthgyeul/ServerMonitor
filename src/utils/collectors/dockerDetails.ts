import {
  DockerContainerDetail,
  DockerDetails,
  DockerDiskUsage,
  DockerImage,
  DockerNetwork,
  DockerVolume
} from '@/types/system';
import { parseDockerBytes, parseJsonLines } from '@/utils/collectors/docker';
import { runArgs, withTtl } from '@/utils/collectors/shell';

// Everything the Docker page shows beyond the live stats in /api/system:
// container configuration (ports, networks, mounts, restart policy, health),
// images, volumes, networks and disk usage. Read with the docker CLI, cached,
// and "unavailable" (not an error) when Docker can't be reached.

const UNAVAILABLE: DockerDetails = {
  available: false,
  containers: [],
  images: [],
  volumes: [],
  networks: [],
  disk: []
};
const DOCKER_TIMEOUT_MS = 10_000;

const short = (id: string | undefined | null): string | null => {
  if (!id) return null;
  const hex = id.replace(/^sha256:/, '');
  return hex.slice(0, 12) || null;
};

// Whole bytes: the CLI's decimal sizes ("2.07GB") don't multiply out exactly.
const bytes = (text: string | undefined | null): number | null => {
  const value = text ? parseDockerBytes(text) : null;
  return value === null ? null : Math.round(value);
};

const isoOrNull = (value: string | undefined | null): string | null => {
  if (!value) return null;
  // `docker image ls` prints "2026-10-01 12:00:00 +0000 UTC".
  const normalized = value
    .replace(/ ([+-]\d{4}) [A-Z]+$/, ' $1')
    .replace(' ', 'T')
    .replace(' ', '');
  const time = Date.parse(normalized);
  if (Number.isFinite(time)) return new Date(time).toISOString();
  const direct = Date.parse(value);
  return Number.isFinite(direct) && direct > 0 ? new Date(direct).toISOString() : null;
};

// --- docker inspect (containers) ------------------------------------------

type PortBindings = Record<string, { HostIp?: string; HostPort?: string }[] | null>;

interface InspectContainer {
  Id?: string;
  Name?: string;
  Image?: string;
  Created?: string;
  Path?: string;
  Args?: string[];
  State?: { Status?: string; Health?: { Status?: string } };
  Config?: { Image?: string };
  HostConfig?: { RestartPolicy?: { Name?: string; MaximumRetryCount?: number }; Memory?: number };
  NetworkSettings?: {
    Networks?: Record<string, unknown>;
    Ports?: PortBindings;
  };
  Mounts?: { Type?: string; Name?: string; Source?: string; Destination?: string; RW?: boolean }[];
}

function formatPorts(ports: PortBindings | undefined): string[] {
  const result: string[] = [];
  for (const [containerPort, bindings] of Object.entries(ports ?? {})) {
    if (!bindings || bindings.length === 0) {
      result.push(containerPort);
      continue;
    }
    for (const binding of bindings) {
      // Docker lists IPv4 and IPv6 bindings separately; show IPv4 only once.
      if (binding.HostIp === '::') continue;
      result.push(`${binding.HostIp || '0.0.0.0'}:${binding.HostPort}→${containerPort}`);
    }
  }
  return result;
}

function formatMount(mount: NonNullable<InspectContainer['Mounts']>[number]): string {
  const source = mount.Type === 'volume' ? (mount.Name ?? mount.Source ?? '') : (mount.Source ?? '');
  return `${source} → ${mount.Destination ?? ''}${mount.RW === false ? ' (ro)' : ''}`;
}

// Pure: `docker inspect <ids…>` JSON array → container details (status text is
// filled in from `docker ps` by the caller).
export function parseContainerInspect(json: string): Omit<DockerContainerDetail, 'status'>[] {
  let rows: InspectContainer[];
  try {
    rows = JSON.parse(json) as InspectContainer[];
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const policy = row.HostConfig?.RestartPolicy;
    const memory = row.HostConfig?.Memory ?? 0;
    const command = [row.Path, ...(row.Args ?? [])].filter(Boolean).join(' ');
    return {
      id: short(row.Id) ?? '',
      name: (row.Name ?? '').replace(/^\//, ''),
      image: row.Config?.Image ?? '',
      imageId: short(row.Image),
      state: (row.State?.Status ?? 'unknown').toLowerCase(),
      ports: formatPorts(row.NetworkSettings?.Ports),
      networks: Object.keys(row.NetworkSettings?.Networks ?? {}),
      mounts: (row.Mounts ?? []).map(formatMount),
      restartPolicy:
        policy?.Name && policy.Name !== 'no'
          ? policy.Name === 'on-failure' && policy.MaximumRetryCount
            ? `on-failure:${policy.MaximumRetryCount}`
            : policy.Name
          : policy?.Name === 'no'
            ? 'no'
            : null,
      health: row.State?.Health?.Status ?? null,
      command: command || null,
      createdAt: isoOrNull(row.Created),
      memLimitMb: memory > 0 ? Math.round(memory / (1024 * 1024)) : null
    };
  });
}

// --- images / volumes / networks / df --------------------------------------

interface ImageRow {
  ID?: string;
  Repository?: string;
  Tag?: string;
  Size?: string;
  CreatedAt?: string;
}

export function parseImages(stdout: string): Omit<DockerImage, 'usedBy'>[] {
  return parseJsonLines<ImageRow>(stdout).map(row => ({
    id: short(row.ID) ?? '',
    repository: row.Repository ?? '<none>',
    tag: row.Tag ?? '<none>',
    sizeBytes: bytes(row.Size),
    createdAt: isoOrNull(row.CreatedAt)
  }));
}

interface InspectNetwork {
  Name?: string;
  Driver?: string;
  IPAM?: { Config?: { Subnet?: string }[] | null };
  Containers?: Record<string, { Name?: string }> | null;
}

export function parseNetworkInspect(json: string): DockerNetwork[] {
  let rows: InspectNetwork[];
  try {
    rows = JSON.parse(json) as InspectNetwork[];
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({
    name: row.Name ?? '',
    driver: row.Driver ?? '',
    subnet: row.IPAM?.Config?.find(config => config.Subnet)?.Subnet ?? null,
    containers: Object.values(row.Containers ?? {})
      .map(container => container.Name ?? '')
      .filter(Boolean)
      .sort()
  }));
}

interface DfRow {
  Type?: string;
  Size?: string;
  Reclaimable?: string;
}

const DF_TYPES: Record<string, DockerDiskUsage['type']> = {
  Images: 'images',
  Containers: 'containers',
  'Local Volumes': 'volumes',
  'Build Cache': 'buildCache'
};

// Pure: `docker system df --format "{{json .}}"` rows ("409MB (21%)").
export function parseSystemDf(stdout: string): DockerDiskUsage[] {
  const usage: DockerDiskUsage[] = [];
  for (const row of parseJsonLines<DfRow>(stdout)) {
    const type = row.Type ? DF_TYPES[row.Type] : undefined;
    if (!type) continue;
    usage.push({
      type,
      sizeBytes: bytes(row.Size) ?? 0,
      reclaimableBytes: bytes((row.Reclaimable ?? '').split(' ')[0]) ?? 0
    });
  }
  return usage;
}

interface DfVerbose {
  Volumes?: { Name?: string; Size?: string }[];
}

// Pure: per-volume sizes from `docker system df -v --format "{{json .}}"`.
export function parseVolumeSizes(json: string): Map<string, number> {
  const sizes = new Map<string, number>();
  try {
    const parsed = JSON.parse(json) as DfVerbose;
    for (const volume of parsed.Volumes ?? []) {
      const size = bytes(volume.Size);
      if (volume.Name && size !== null) sizes.set(volume.Name, size);
    }
  } catch {
    /* older docker: no verbose JSON — sizes stay unknown */
  }
  return sizes;
}

interface PsRow {
  ID?: string;
  Status?: string;
}

interface VolumeRow {
  Name?: string;
  Driver?: string;
}

// Containers whose mounts reference the volume by name.
function volumeUsers(volume: string, containers: DockerContainerDetail[]): string[] {
  return containers
    .filter(container => container.mounts.some(mount => mount.startsWith(`${volume} → `)))
    .map(c => c.name);
}

// Disk usage changes slowly and `df -v` walks every volume, so it refreshes less often.
const readVolumeSizes = withTtl(60_000, async () =>
  parseVolumeSizes(
    await runArgs('docker', ['system', 'df', '-v', '--format', '{{json .}}'], DOCKER_TIMEOUT_MS)
  )
);

export const getDockerDetails = withTtl(15_000, async (): Promise<DockerDetails> => {
  if (/^(1|true)$/i.test(process.env.DOCKER_DISABLED ?? '')) return UNAVAILABLE;

  let psOut: string;
  try {
    psOut = await runArgs('docker', ['ps', '-a', '--format', '{{json .}}'], DOCKER_TIMEOUT_MS);
  } catch {
    return UNAVAILABLE;
  }
  const ps = parseJsonLines<PsRow>(psOut);
  const statusById = new Map(ps.map(row => [(row.ID ?? '').slice(0, 12), row.Status ?? '']));
  const ids = ps.map(row => row.ID ?? '').filter(id => /^[0-9a-f]+$/i.test(id));

  const [inspectOut, imagesOut, volumesOut, networkIdsOut, dfOut] = await Promise.all([
    ids.length
      ? runArgs('docker', ['inspect', ...ids], DOCKER_TIMEOUT_MS).catch(() => '[]')
      : Promise.resolve('[]'),
    runArgs('docker', ['image', 'ls', '--format', '{{json .}}'], DOCKER_TIMEOUT_MS).catch(() => ''),
    runArgs('docker', ['volume', 'ls', '--format', '{{json .}}'], DOCKER_TIMEOUT_MS).catch(() => ''),
    runArgs('docker', ['network', 'ls', '-q'], DOCKER_TIMEOUT_MS).catch(() => ''),
    runArgs('docker', ['system', 'df', '--format', '{{json .}}'], DOCKER_TIMEOUT_MS).catch(() => '')
  ]);

  const containers: DockerContainerDetail[] = parseContainerInspect(inspectOut)
    .map(container => ({ ...container, status: statusById.get(container.id) ?? '' }))
    .sort(
      (a, b) => Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name)
    );

  const images: DockerImage[] = parseImages(imagesOut).map(image => ({
    ...image,
    usedBy: containers.filter(container => container.imageId === image.id).map(container => container.name)
  }));

  const sizes = await readVolumeSizes().catch(() => new Map<string, number>());
  const volumes: DockerVolume[] = parseJsonLines<VolumeRow>(volumesOut).map(row => ({
    name: row.Name ?? '',
    driver: row.Driver ?? 'local',
    sizeBytes: sizes.get(row.Name ?? '') ?? null,
    usedBy: volumeUsers(row.Name ?? '', containers)
  }));

  const networkIds = networkIdsOut
    .split('\n')
    .map(id => id.trim())
    .filter(id => /^[0-9a-f]+$/i.test(id));
  const networks = networkIds.length
    ? parseNetworkInspect(
        await runArgs('docker', ['network', 'inspect', ...networkIds], DOCKER_TIMEOUT_MS).catch(() => '[]')
      )
    : [];

  return { available: true, containers, images, volumes, networks, disk: parseSystemDf(dfOut) };
});

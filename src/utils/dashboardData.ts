import {
  AlertEntry,
  HistoryInfo,
  HostInfo,
  LoadInfo,
  NetworkInterfaceInfo,
  Process,
  SecurityInfo,
  ServerData,
  SwapInfo,
  DiskIoInfo,
  GpuInfo,
  TemperatureInfo,
  TemperatureValue
} from '@/types/system';

// API 의 새 필드들은 전부 optional 이다(구버전 노드 호환). 컴포넌트마다
// `?? 0` 을 흩뿌리는 대신, 화면에 넘기기 직전 한 번만 기본값을 채운다.
export interface DashboardData {
  cpu: {
    usage: number;
    cores: number;
    temperature: TemperatureValue;
    perCore: number[];
  };
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number };
  swap: SwapInfo;
  diskIO: DiskIoInfo;
  gpu: GpuInfo;
  network: {
    download: number;
    upload: number;
    ping: number;
    errorRates: { rx: string; tx: string };
    connections: number;
    listeningPorts: number;
    interfaces: NetworkInterfaceInfo[];
    linkSpeedMbps: number | null;
    bandwidthPercentage: number;
  };
  uptime: { days: number; hours: number; minutes: number };
  temperature: TemperatureInfo;
  fan: { cpu: number; case1: number; case2: number };
  processes: Process[];
  host: HostInfo;
  load: LoadInfo;
  security: SecurityInfo;
  history: HistoryInfo;
  alerts: AlertEntry[];
  timestamp: string;
  warnings: string[];
}

const EMPTY_HISTORY: HistoryInfo = { load: [], cpuHourly: [] };

const EMPTY_SECURITY: SecurityInfo = {
  firewall: { status: 'unknown', backend: null, blockedAttempts: null },
  sshSessions: [],
  topTraffic: []
};

export function toDashboardData(raw: ServerData): DashboardData {
  return {
    cpu: {
      usage: raw.cpu.usage,
      cores: raw.cpu.cores,
      temperature: raw.cpu.temperature,
      perCore: raw.cpu.perCore ?? []
    },
    memory: raw.memory,
    disk: raw.disk,
    swap: raw.swap ?? { used: 0, total: 0, percentage: 0 },
    diskIO: raw.diskIO ?? { read: 0, write: 0 },
    gpu: raw.gpu ?? { name: null, usage: 'N/A', temperature: 'N/A' },
    network: {
      download: raw.network.download,
      upload: raw.network.upload,
      ping: raw.network.ping,
      errorRates: raw.network.errorRates,
      connections: raw.network.connections ?? 0,
      listeningPorts: raw.network.listeningPorts ?? 0,
      interfaces: raw.network.interfaces ?? [],
      linkSpeedMbps: raw.network.linkSpeedMbps ?? null,
      bandwidthPercentage: raw.network.bandwidthPercentage ?? 0
    },
    uptime: raw.uptime,
    temperature: raw.temperature,
    fan: raw.fan,
    processes: raw.processes,
    host: raw.host ?? {
      hostname: '—',
      os: 'unknown',
      kernel: '—',
      arch: '—',
      bootTime: new Date().toISOString(),
      rebootReason: null
    },
    load: raw.load ?? { avg1: 0, avg5: 0, avg15: 0 },
    security: raw.security ?? EMPTY_SECURITY,
    history: raw.history ?? EMPTY_HISTORY,
    alerts: raw.alerts ?? [],
    timestamp: raw.timestamp ?? new Date().toISOString(),
    warnings: raw.warnings ?? []
  };
}

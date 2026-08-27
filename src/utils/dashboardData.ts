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
  DiskMount,
  GpuInfo,
  ProcessSummary,
  BatteryInfo,
  TemperatureInfo,
  TemperatureValue,
  MemoryDetail,
  ServicesInfo,
  PackagesInfo,
  SmartDevice,
  ReadOnlyMount
} from '@/types/system';

// The API's new fields are all optional (old-node compatible). Rather than
// scattering `?? 0` across every component, fill defaults once, right before handing off to the screen.
export interface DashboardData {
  cpu: {
    usage: number;
    cores: number;
    temperature: TemperatureValue;
    perCore: number[];
    iowait: number;
    steal: number;
    frequencyMhz: number | 'N/A';
  };
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number; hoursToFull: number | null };
  disks: DiskMount[];
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
    totalRxBytes: number;
    totalTxBytes: number;
  };
  uptime: { days: number; hours: number; minutes: number };
  temperature: TemperatureInfo;
  fan: { cpu: number; case1: number; case2: number };
  processes: Process[];
  host: HostInfo;
  load: LoadInfo;
  security: SecurityInfo;
  processSummary: ProcessSummary;
  topProcessesByMemory: Process[];
  battery: BatteryInfo | null;
  memoryDetail: MemoryDetail | null;
  services: ServicesInfo;
  packages: PackagesInfo | null;
  smart: SmartDevice[];
  readOnlyMounts: ReadOnlyMount[];
  kernelErrors: number | null;
  failedLogins: number | null;
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
      perCore: raw.cpu.perCore ?? [],
      iowait: raw.cpu.iowait ?? 0,
      steal: raw.cpu.steal ?? 0,
      frequencyMhz: raw.cpu.frequencyMhz ?? 'N/A'
    },
    memory: raw.memory,
    disk: { ...raw.disk, hoursToFull: raw.disk.hoursToFull ?? null },
    disks: raw.disks ?? [],
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
      bandwidthPercentage: raw.network.bandwidthPercentage ?? 0,
      totalRxBytes: raw.network.totalRxBytes ?? 0,
      totalTxBytes: raw.network.totalTxBytes ?? 0
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
      rebootReason: null,
      virtualization: null
    },
    load: raw.load ?? { avg1: 0, avg5: 0, avg15: 0, running: null, avg30: null, avg30WindowSeconds: 0 },
    security: raw.security ?? EMPTY_SECURITY,
    processSummary: raw.processSummary ?? { total: 0, running: 0, sleeping: 0, zombie: 0, threads: null },
    topProcessesByMemory: raw.topProcessesByMemory ?? [],
    battery: raw.battery ?? null,
    memoryDetail: raw.memoryDetail ?? null,
    services: raw.services ?? { failed: null, failedUnits: [] },
    packages: raw.packages ?? null,
    smart: raw.smart ?? [],
    readOnlyMounts: raw.readOnlyMounts ?? [],
    kernelErrors: raw.kernelErrors ?? null,
    failedLogins: raw.failedLogins ?? null,
    history: raw.history ?? EMPTY_HISTORY,
    alerts: raw.alerts ?? [],
    timestamp: raw.timestamp ?? new Date().toISOString(),
    warnings: raw.warnings ?? []
  };
}

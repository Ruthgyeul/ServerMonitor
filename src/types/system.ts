export interface Process {
  id: number;
  name: string;
  cpu: number;
  memory: number;
  status: 'running' | 'sleeping';
}

// Temperature value type
export type TemperatureValue = number | 'N/A';

// Temperature info for the x86 architecture
export interface X86TemperatureInfo {
  cpu: TemperatureValue;
  gpu: TemperatureValue;
  motherboard: TemperatureValue;
}

// Temperature info for the ARM architecture
export interface ARMTemperatureInfo {
  cpu: TemperatureValue;
  rp1: TemperatureValue;
  ssd: TemperatureValue;
}

// Temperature info (per architecture)
export type TemperatureInfo = X86TemperatureInfo | ARMTemperatureInfo;

// Temperature info type guards
export function isX86TemperatureInfo(temp: TemperatureInfo): temp is X86TemperatureInfo {
  return 'gpu' in temp && 'motherboard' in temp;
}

export function isARMTemperatureInfo(temp: TemperatureInfo): temp is ARMTemperatureInfo {
  return 'rp1' in temp && 'ssd' in temp;
}

// Host identification. Used for the header's "Ubuntu 22.04 · 5.15.0" text and the reboot history.
export interface HostInfo {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  bootTime: string; // ISO 8601
  // Whether the last reboot was a clean shutdown. null if wtmp can't be read.
  rebootReason: string | null;
  // Virtualization/container kind (kvm/docker/lxc, etc.). null on bare metal or when undetectable.
  virtualization?: string | null;
}

export interface LoadInfo {
  avg1: number;
  avg5: number;
  avg15: number;
  // The number of kernel entities running or waiting to run right now. The
  // value before the slash in /proc/loadavg's 4th field (running/total), an
  // instantaneous value in the same unit as the load average. null on an OS without /proc.
  running: number | null;
  // The kernel only provides 1/5/15-minute averages. We compute the 30-minute
  // one from the samples we record every second. If 30 minutes haven't elapsed
  // yet it's the average of what's collected so far, and null if there are no samples.
  avg30: number | null;
  // The span avg30 actually covers (seconds). Below 1800 the window isn't full yet.
  avg30WindowSeconds: number;
}

export interface SwapInfo {
  used: number; // GB
  total: number; // GB
  percentage: number;
}

export interface DiskIoInfo {
  read: number; // MB/s
  write: number; // MB/s
}

export interface GpuInfo {
  name: string | null;
  usage: number | 'N/A';
  temperature: TemperatureValue;
}

export interface NetworkInterfaceInfo {
  name: string;
  ip: string | null;
  speedMbps: number | null;
  state: 'up' | 'down' | 'unknown';
  isDefault: boolean;
}

// Top bandwidth peers. If nf_conntrack byte accounting is off, bytes is null
// and only the connection count is meaningful.
export interface TrafficPeer {
  ip: string;
  bytes: number | null;
  connections: number;
}

export interface SshSession {
  user: string;
  ip: string;
  since: string; // ISO 8601
}

export interface FirewallInfo {
  status: 'active' | 'inactive' | 'unknown';
  backend: string | null;
  // null if there's no permission to read the kernel log.
  blockedAttempts: number | null;
}

export interface SecurityInfo {
  firewall: FirewallInfo;
  sshSessions: SshSession[];
  topTraffic: TrafficPeer[];
}

// Usage of an individually mounted filesystem. Lets servers with a separate
// data volume besides root (/) see their real usage too.
export interface DiskMount {
  mount: string;
  used: number; // GB
  total: number; // GB
  percentage: number;
}

// Battery/UPS status. Meaningful on Pi/laptop/UPS-connected servers, null otherwise.
export interface BatteryInfo {
  percentage: number;
  status: string; // Charging / Discharging / Full / Not charging / Unknown
}

// Whole-process summary. Unlike the top list (top 20), it counts the whole system.
export interface ProcessSummary {
  total: number;
  running: number;
  sleeping: number;
  zombie: number;
  // Total task count including threads. Obtained from /proc/loadavg, null if unavailable.
  threads: number | null;
}

// Finer memory breakdown (MB). null when the field is absent from /proc/meminfo.
export interface MemoryDetail {
  cached: number | null;
  buffers: number | null;
  available: number | null;
  shared: number | null;
  slab: number | null;
  swapCached: number | null;
}

// Failed systemd services. failed is null when systemd isn't present.
export interface ServicesInfo {
  failed: number | null;
  failedUnits: string[];
}

// Pending package updates, with a security subtotal.
export interface PackagesInfo {
  total: number;
  security: number;
}

// Per-drive SMART summary. healthy null = no self-assessment available.
export interface SmartDevice {
  device: string;
  healthy: boolean | null;
  temperature: TemperatureValue;
  powerOnHours: number | null;
}

// A filesystem currently mounted read-only (a silent-failure signal).
export interface ReadOnlyMount {
  mount: string;
  device: string;
  fstype: string;
}

export type AlertLevel = 'ok' | 'info' | 'warning' | 'critical';

export interface AlertEntry {
  id: string;
  level: AlertLevel;
  message: string;
  at: string; // ISO 8601
}

// History accumulates in process memory and is persisted to data/history.json.
// It recovers across restarts, but a stretch when the server was down has no
// value, which the UI shows as "collecting".
export interface LoadSample {
  at: string; // ISO 8601, start of the 1-hour bucket
  // null if the server wasn't up during that hour.
  avg1: number | null;
}

export interface CpuHourSample {
  at: string; // ISO 8601, start of the on-the-hour bucket
  usage: number | null;
}

// A generic per-metric hourly trend point (memory %, disk %, temp °C, net KB/s).
export interface TrendSample {
  at: string; // ISO 8601, start of the 1-hour bucket
  value: number | null; // null if the server wasn't up / metric unavailable that hour
}

export interface HistoryTrends {
  mem: TrendSample[];
  disk: TrendSample[];
  temp: TrendSample[];
  net: TrendSample[];
}

export interface HistoryInfo {
  load: LoadSample[]; // last 48 hours, 1-hour buckets
  cpuHourly: CpuHourSample[]; // last 24 hours, 1-hour buckets
  // Added in 2.3: per-metric 24h trend series (optional: old-node compatible).
  trends?: HistoryTrends;
}

export interface ServerData {
  cpu: {
    usage: number;
    cores: number;
    temperature: TemperatureValue;
    // Per-core usage. Empty array if /proc/stat can't be read.
    perCore?: number[];
    // The following are optional (old-node compatible). iowait/steal are %, frequencyMhz is average MHz.
    iowait?: number;
    steal?: number;
    frequencyMhz?: number | 'N/A';
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  disk: {
    used: number;
    total: number;
    percentage: number;
    // Estimated hours until 100% based on the recent trend. null when not filling.
    hoursToFull?: number | null;
  };
  // Full filesystem list including non-root mounts (optional: old-node compatible).
  disks?: DiskMount[];
  network: {
    download: number;
    upload: number;
    ping: number;
    errorRates: {
      rx: string;
      tx: string;
    };
    connections?: number;
    listeningPorts?: number;
    interfaces?: NetworkInterfaceInfo[];
    linkSpeedMbps?: number | null;
    bandwidthPercentage?: number;
    // Cumulative bytes since boot (optional: old-node compatible).
    totalRxBytes?: number;
    totalTxBytes?: number;
  };
  uptime: {
    days: number;
    hours: number;
    minutes: number;
  };
  temperature: TemperatureInfo;
  fan: {
    cpu: number;
    case1: number;
    case2: number;
  };
  processes: Process[];
  // The fields below were added in 1.3. Cluster nodes running older versions
  // must still be readable by the same dashboard, so all are optional.
  host?: HostInfo;
  load?: LoadInfo;
  swap?: SwapInfo;
  diskIO?: DiskIoInfo;
  gpu?: GpuInfo;
  security?: SecurityInfo;
  // Whole-process summary / memory-top processes / battery (optional: old-node compatible).
  processSummary?: ProcessSummary;
  topProcessesByMemory?: Process[];
  battery?: BatteryInfo | null;
  history?: HistoryInfo;
  alerts?: AlertEntry[];
  // Added in 2.3 (all optional: old-node compatible).
  memoryDetail?: MemoryDetail;
  services?: ServicesInfo;
  packages?: PackagesInfo | null;
  smart?: SmartDevice[];
  readOnlyMounts?: ReadOnlyMount[];
  kernelErrors?: number | null;
  failedLogins?: number | null;
  timestamp?: string;
  // When only some collectors fail, tells you which metric is empty and why.
  // Lets you diagnose a headless server with just `curl localhost:3000/api/system`.
  warnings?: string[];
}

export interface NetworkHistoryEntry {
  time: string;
  download: number;
  upload: number;
}

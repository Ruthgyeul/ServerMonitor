import os from 'os';
import { readFile, readdir } from 'fs/promises';

import {
  ServerData,
  Process,
  X86TemperatureInfo,
  ARMTemperatureInfo,
  TemperatureInfo,
  TemperatureValue,
  SecurityInfo,
  LoadInfo,
  DiskMount,
  ProcessSummary,
  BatteryInfo
} from '@/types/system';
import { collect, readSys, round, run } from '@/utils/collectors/shell';
import { parseDf } from '@/utils/collectors/df';
import { getBatteryInfo } from '@/utils/collectors/battery';
import { getHoursToFull, recordDiskSample } from '@/utils/collectors/diskTrend';
import { getCpuUsage } from '@/utils/collectors/cpu';
import { getHostInfo } from '@/utils/collectors/host';
import { getLoadAverage, getSwapInfo } from '@/utils/collectors/load';
import { getDiskIo } from '@/utils/collectors/diskio';
import { getGpuInfo } from '@/utils/collectors/gpu';
import {
  getDefaultInterface,
  getInterfaces,
  getSocketSummary,
  getTopTraffic,
  readInterfaceStat,
  SocketSummary
} from '@/utils/collectors/netstat';
import { getFirewallInfo, getSshSessions } from '@/utils/collectors/security';
import { getHistory, getLoad30mAverage, recordSample } from '@/utils/collectors/history';
import { evaluateAlerts } from '@/utils/collectors/alerts';

// Cached system info
let cachedData: ServerData | null = null;
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000; // update once per second

interface CpuInfo {
  usage: number;
  cores: number;
  temperature: number | 'N/A';
  perCore: number[];
  iowait: number;
  steal: number;
  frequencyMhz: number | 'N/A';
}

interface MemoryInfo {
  used: number;
  total: number;
  percentage: number;
}

interface DiskInfo {
  used: number;
  total: number;
  percentage: number;
}

interface NetworkInfo {
  download: number;
  upload: number;
  ping: number;
  errorRates: {
    rx: string;
    tx: string;
  };
  connections: number;
  listeningPorts: number;
  interfaces: ServerData['network']['interfaces'];
  linkSpeedMbps: number | null;
  bandwidthPercentage: number;
  // Cumulative rx/tx bytes on the default interface since boot. Used for monthly bandwidth budgeting.
  totalRxBytes: number;
  totalTxBytes: number;
}

interface FanInfo {
  cpu: number;
  case1: number;
  case2: number;
}

interface UptimeInfo {
  days: number;
  hours: number;
  minutes: number;
}

function getArchitecture(): 'x86' | 'arm' | 'unknown' {
  const arch = os.arch();
  if (arch === 'x64' || arch === 'ia32') return 'x86';
  if (arch === 'arm64' || arch === 'arm') return 'arm';
  return 'unknown';
}

// --- CPU ---------------------------------------------------------------

async function getCpuInfo(warnings: string[]): Promise<CpuInfo> {
  const [usage, temperature] = await Promise.all([
    collect(
      'cpu.usage',
      getCpuUsage,
      { total: 0, perCore: [], iowait: 0, steal: 0, frequencyMhz: 'N/A' as const },
      warnings
    ),
    collect<number | 'N/A'>('cpu.temperature', getCpuTemperature, 'N/A', warnings)
  ]);

  return {
    usage: usage.total,
    perCore: usage.perCore,
    cores: os.cpus().length,
    temperature,
    iowait: usage.iowait,
    steal: usage.steal,
    frequencyMhz: usage.frequencyMhz
  };
}

// --- Memory ------------------------------------------------------------

async function getMemoryInfo(): Promise<MemoryInfo> {
  const contents = await readFile('/proc/meminfo', 'utf-8');
  const field = (key: string) => {
    const match = contents.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
    return match ? parseInt(match[1], 10) : null;
  };

  const totalKb = field('MemTotal');
  if (!totalKb) throw new Error('MemTotal missing from /proc/meminfo');

  // If the kernel lacks MemAvailable (< 3.14), approximate with free + buffers + cached.
  const availableKb =
    field('MemAvailable') ?? (field('MemFree') ?? 0) + (field('Buffers') ?? 0) + (field('Cached') ?? 0);

  const usedKb = Math.max(0, totalKb - availableKb);
  return {
    used: Math.round(usedKb / 1024),
    total: Math.round(totalKb / 1024),
    percentage: round((usedKb / totalKb) * 100, 1)
  };
}

// --- Disk --------------------------------------------------------------

interface DiskReport extends DiskInfo {
  mounts: DiskMount[];
}

async function getDiskInfo(): Promise<DiskReport> {
  // -P stops long device names from wrapping a row onto two lines, and -k pins
  // 1K blocks so we don't have to parse "20G"/"1.5T"/"800M" units.
  // With no path argument it reads every mount, returning non-root filesystems too.
  const stdout = await run('df -Pk');
  const mounts = parseDf(stdout);

  const root = mounts.find(mount => mount.mount === '/');
  if (!root) {
    throw new Error(`no root filesystem in df output: ${stdout.split('\n')[1] ?? ''}`);
  }

  return { used: root.used, total: root.total, percentage: root.percentage, mounts };
}

// --- Network -----------------------------------------------------------

let prevNetSample: { rx: number; tx: number; at: number } | null = null;

async function getPing(): Promise<number> {
  const host = process.env.PING_HOST || '8.8.8.8';
  if (!/^[a-zA-Z0-9.:-]+$/.test(host)) {
    throw new Error(`invalid PING_HOST: ${host}`);
  }

  // -W 1: stops it from waiting the default 10s and holding up the whole request when there's no reply.
  const stdout = await run(`ping -c 1 -W 1 ${host} || true`);
  const match = stdout.match(/time[=<]\s*([\d.]+)\s*ms/);
  return match ? parseFloat(match[1]) : 0;
}

async function getNetworkInfo(warnings: string[], sockets: SocketSummary): Promise<NetworkInfo> {
  const interfaceName = await getDefaultInterface();

  const [rxBytes, txBytes, rxErrors, txErrors, rxPackets, txPackets] = await Promise.all([
    readInterfaceStat(interfaceName, 'rx_bytes'),
    readInterfaceStat(interfaceName, 'tx_bytes'),
    readInterfaceStat(interfaceName, 'rx_errors'),
    readInterfaceStat(interfaceName, 'tx_errors'),
    readInterfaceStat(interfaceName, 'rx_packets'),
    readInterfaceStat(interfaceName, 'tx_packets')
  ]);

  const now = Date.now();
  const previous = prevNetSample;
  prevNetSample = { rx: rxBytes, tx: txBytes, at: now };

  // Divide by the actual elapsed time since the previous sample. Assuming the
  // polling interval is exactly 1s would inflate the rate whenever requests lag.
  let download = 0;
  let upload = 0;
  if (previous) {
    const elapsedSeconds = (now - previous.at) / 1000;
    if (elapsedSeconds > 0) {
      // If the counter resets (reboot / interface swap) the result goes negative, so clamp to 0.
      download = Math.max(0, (rxBytes - previous.rx) / 1024 / elapsedSeconds);
      upload = Math.max(0, (txBytes - previous.tx) / 1024 / elapsedSeconds);
    }
  }

  // The error rate is only meaningful against packets, not bytes.
  const rate = (errors: number, packets: number) =>
    packets > 0 ? ((errors / packets) * 100).toFixed(2) : '0.00';

  const [ping, interfaces] = await Promise.all([
    collect('network.ping', getPing, 0, warnings),
    collect('network.interfaces', () => getInterfaces(interfaceName), [], warnings)
  ]);

  const linkSpeedMbps = interfaces.find(entry => entry.isDefault)?.speedMbps ?? null;
  // Convert the link speed (Mbps) to KB/s to compare against current throughput in the same unit.
  const linkCapacityKbps = linkSpeedMbps === null ? null : (linkSpeedMbps * 1000) / 8;

  return {
    download: round(download),
    upload: round(upload),
    ping,
    errorRates: {
      rx: rate(rxErrors, rxPackets),
      tx: rate(txErrors, txPackets)
    },
    connections: sockets.connections,
    listeningPorts: sockets.listeningPorts,
    interfaces,
    linkSpeedMbps,
    bandwidthPercentage:
      linkCapacityKbps === null ? 0 : round(Math.min(100, ((download + upload) / linkCapacityKbps) * 100), 1),
    totalRxBytes: rxBytes,
    totalTxBytes: txBytes
  };
}

// --- Temperature / Fan -------------------------------------------------

async function readSensors(): Promise<string> {
  return run('sensors');
}

// The sysfs fallback path for servers without lm-sensors (most VPSes/containers).
async function readThermalZone(): Promise<number | 'N/A'> {
  let entries: string[];
  try {
    entries = await readdir('/sys/class/thermal');
  } catch {
    return 'N/A';
  }

  const zones = entries.filter(name => /^thermal_zone\d+$/.test(name));
  const preferred = ['x86_pkg_temp', 'cpu_thermal', 'coretemp', 'cpu-thermal', 'soc_thermal'];

  let fallback: number | 'N/A' = 'N/A';
  for (const zone of zones) {
    const raw = await readSys(`/sys/class/thermal/${zone}/temp`);
    if (raw === null) continue;
    const milliCelsius = parseInt(raw, 10);
    if (Number.isNaN(milliCelsius)) continue;

    const celsius = round(milliCelsius / 1000, 1);
    const type = (await readSys(`/sys/class/thermal/${zone}/type`)) ?? '';
    if (preferred.includes(type)) return celsius;
    if (fallback === 'N/A') fallback = celsius;
  }

  return fallback;
}

async function getCpuTemperature(): Promise<number | 'N/A'> {
  const arch = getArchitecture();

  try {
    const sensors = await readSensors();
    const match =
      arch === 'x86'
        ? sensors.match(/Package id 0:\s+\+?([\d.]+)°C/)
        : sensors.match(/cpu_thermal[\s\S]*?temp1:\s*\+?([\d.]+)°C/);
    if (match) return parseFloat(match[1]);
  } catch {
    // sensors not installed. Fall through to the sysfs path below.
  }

  return readThermalZone();
}

async function getTemperature(): Promise<TemperatureInfo> {
  const arch = getArchitecture();
  let sensors = '';
  try {
    sensors = await readSensors();
  } catch {
    sensors = '';
  }

  const pick = (pattern: RegExp): TemperatureValue => {
    const match = sensors.match(pattern);
    return match ? parseFloat(match[1]) : 'N/A';
  };

  const cpu = await getCpuTemperature();

  if (arch === 'x86') {
    const x86: X86TemperatureInfo = {
      cpu,
      gpu: pick(/edge:\s+\+?([\d.]+)°C/),
      motherboard: pick(/(?:SYSTIN|temp1):\s+\+?([\d.]+)°C/)
    };
    return x86;
  }

  const arm: ARMTemperatureInfo = {
    cpu,
    rp1: pick(/rp1_adc-isa-0000[\s\S]*?temp1:\s*\+?([\d.]+)°C/),
    ssd: pick(/nvme-pci-\w+[\s\S]*?Composite:\s*\+?([\d.]+)°C/)
  };
  return arm;
}

// Without lm-sensors, read hwmon's fan*_input directly.
async function readHwmonFans(): Promise<number[]> {
  let hwmons: string[];
  try {
    hwmons = await readdir('/sys/class/hwmon');
  } catch {
    return [];
  }

  const speeds: number[] = [];
  for (const hwmon of hwmons) {
    for (const index of [1, 2, 3]) {
      const raw = await readSys(`/sys/class/hwmon/${hwmon}/fan${index}_input`);
      if (raw === null) continue;
      const rpm = parseInt(raw, 10);
      if (!Number.isNaN(rpm)) speeds.push(rpm);
    }
  }
  return speeds;
}

async function getFanSpeed(): Promise<FanInfo> {
  try {
    const sensors = await readSensors();
    const read = (pattern: RegExp) => parseInt(sensors.match(pattern)?.[1] ?? '0', 10) || 0;
    const fans = {
      cpu: read(/fan1:\s+(\d+)/),
      case1: read(/fan2:\s+(\d+)/),
      case2: read(/fan3:\s+(\d+)/)
    };
    if (fans.cpu || fans.case1 || fans.case2) return fans;
  } catch {
    // sensors not installed. Fall through to hwmon.
  }

  const [cpu = 0, case1 = 0, case2 = 0] = await readHwmonFans();
  return { cpu, case1, case2 };
}

// --- Processes / Uptime ------------------------------------------------

// Read only `comm` (the executable name), not `args` (the full command line).
// Command-line arguments often expose passwords/tokens directly (e.g. `mysql
// -pSECRET`, `--api-key=...`), and this list also goes out over the API, so the
// executable name is enough and safe. The pipeline's exit code is head's, so it
// stays 0 even if ps fails. Passing empty output through would leave the list
// blank with no cause, so raise an error here.
async function getProcessesBy(sort: '-pcpu' | '-pmem'): Promise<Process[]> {
  const stdout = await run(`ps -eo pid,pcpu,pmem,stat,comm --sort=${sort} | head -n 21`);
  const lines = stdout.split('\n').slice(1); // drop the header
  if (lines.length === 0) {
    throw new Error('ps returned no rows (does this ps support --sort?)');
  }

  const processes = lines
    .map((line, index) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) return null;

      const [, cpu, mem, stat, ...commandParts] = parts;
      const cpuUsage = parseFloat(cpu);
      const memUsage = parseFloat(mem);
      if (Number.isNaN(cpuUsage) || Number.isNaN(memUsage)) return null;

      return {
        id: index + 1,
        name: commandParts.join(' '),
        cpu: cpuUsage,
        memory: memUsage,
        status: stat.startsWith('R') ? 'running' : 'sleeping'
      } as Process;
    })
    .filter((process): process is Process => process !== null);

  if (processes.length === 0) {
    throw new Error(`ps output could not be parsed: ${lines[0]}`);
  }
  return processes;
}

function getProcesses(): Promise<Process[]> {
  return getProcessesBy('-pcpu');
}

// Whole-system process summary. Unlike the top list (top 20) it counts the
// entire system. Reads just one state character (`stat=`) to stay light, and
// surfaces anomalies like a zombie (Z) spike. The thread-inclusive task count
// comes from the denominator in /proc/loadavg.
async function getProcessSummary(): Promise<ProcessSummary> {
  const stdout = await run('ps -eo stat= 2>/dev/null');
  const states = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (states.length === 0) throw new Error('ps returned no process states');

  let running = 0;
  let sleeping = 0;
  let zombie = 0;
  for (const state of states) {
    const first = state[0];
    if (first === 'R') running += 1;
    else if (first === 'Z') zombie += 1;
    else sleeping += 1;
  }

  let threads: number | null = null;
  try {
    const loadavg = await readFile('/proc/loadavg', 'utf-8');
    const match = loadavg.match(/\d+\/(\d+)/);
    if (match) threads = parseInt(match[1], 10);
  } catch {
    // no /proc (not Linux). Leave the thread count empty.
  }

  return { total: states.length, running, sleeping, zombie, threads };
}

async function getUptime(): Promise<UptimeInfo> {
  // `uptime -p` is missing on busybox and its output is locale-dependent. os.uptime() is safe.
  const seconds = os.uptime();
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60)
  };
}

// --- Security ----------------------------------------------------------

async function getSecurityInfo(peers: Map<string, number>, warnings: string[]): Promise<SecurityInfo> {
  const [firewall, sshSessions, topTraffic] = await Promise.all([
    collect(
      'security.firewall',
      getFirewallInfo,
      { status: 'unknown' as const, backend: null, blockedAttempts: null },
      warnings
    ),
    collect('security.sshSessions', getSshSessions, [], warnings),
    collect('security.topTraffic', () => getTopTraffic(peers), [], warnings)
  ]);

  return { firewall, sshSessions, topTraffic };
}

// --- Public API --------------------------------------------------------

function emptyTemperature(): TemperatureInfo {
  return getArchitecture() === 'x86'
    ? { cpu: 'N/A', gpu: 'N/A', motherboard: 'N/A' }
    : { cpu: 'N/A', rp1: 'N/A', ssd: 'N/A' };
}

export async function getSystemInfo(): Promise<ServerData> {
  const now = Date.now();

  if (cachedData && now - lastUpdateTime < UPDATE_INTERVAL) {
    return cachedData;
  }

  const warnings: string[] = [];

  // Connection count, open ports, and top traffic peers all come from the same
  // socket list. Read it once and share it between the network/security collectors.
  const sockets = await collect(
    'network.sockets',
    getSocketSummary,
    { connections: 0, listeningPorts: 0, peers: new Map<string, number>() },
    warnings
  );

  // Wrap each with its own fallback rather than a bare Promise.all. Previously a
  // single collector failure dropped the whole response to zeros.
  const [
    cpu,
    memory,
    disk,
    network,
    temperature,
    fan,
    processes,
    uptime,
    host,
    swap,
    diskIO,
    gpu,
    processSummary,
    topProcessesByMemory,
    battery
  ] = await Promise.all([
    getCpuInfo(warnings),
    collect('memory', getMemoryInfo, { used: 0, total: 0, percentage: 0 }, warnings),
    collect('disk', getDiskInfo, { used: 0, total: 0, percentage: 0, mounts: [] as DiskMount[] }, warnings),
    collect(
      'network',
      () => getNetworkInfo(warnings, sockets),
      {
        download: 0,
        upload: 0,
        ping: 0,
        errorRates: { rx: '0.00', tx: '0.00' },
        connections: 0,
        listeningPorts: 0,
        interfaces: [],
        linkSpeedMbps: null,
        bandwidthPercentage: 0,
        totalRxBytes: 0,
        totalTxBytes: 0
      },
      warnings
    ),
    collect('temperature', getTemperature, emptyTemperature(), warnings),
    collect('fan', getFanSpeed, { cpu: 0, case1: 0, case2: 0 }, warnings),
    collect<Process[]>('processes', getProcesses, [], warnings),
    collect('uptime', getUptime, { days: 0, hours: 0, minutes: 0 }, warnings),
    collect(
      'host',
      getHostInfo,
      {
        hostname: os.hostname(),
        os: `${os.type()} ${os.release()}`,
        kernel: os.release(),
        arch: os.arch(),
        bootTime: new Date(Date.now() - os.uptime() * 1000).toISOString(),
        rebootReason: null,
        virtualization: null
      },
      warnings
    ),
    collect('swap', getSwapInfo, { used: 0, total: 0, percentage: 0 }, warnings),
    collect('diskIO', getDiskIo, { read: 0, write: 0 }, warnings),
    collect('gpu', getGpuInfo, { name: null, usage: 'N/A' as const, temperature: 'N/A' as const }, warnings),
    collect<ProcessSummary>(
      'processSummary',
      getProcessSummary,
      { total: 0, running: 0, sleeping: 0, zombie: 0, threads: null },
      warnings
    ),
    collect<Process[]>('processesByMemory', () => getProcessesBy('-pmem'), [], warnings),
    collect<BatteryInfo | null>('battery', getBatteryInfo, null, warnings)
  ]);

  const loadBase = await getLoadAverage();
  const security = await getSecurityInfo(sockets.peers, warnings);

  recordSample(cpu.usage, loadBase.avg1, now);
  recordDiskSample(disk.percentage, now);
  const diskHoursToFull = getHoursToFull(now);

  // The window must include the sample we just added, so read it after recordSample.
  const rolling30m = getLoad30mAverage(now);
  const load: LoadInfo = {
    ...loadBase,
    avg30: rolling30m.value,
    avg30WindowSeconds: rolling30m.windowSeconds
  };

  const alerts = evaluateAlerts(
    {
      cpu: cpu.usage,
      memory: memory.percentage,
      disk: disk.percentage,
      swap: swap.percentage,
      temperature: cpu.temperature,
      firewall: security.firewall.status,
      sshSessions: security.sshSessions,
      interfaces: (network.interfaces ?? []).map(({ name, state }) => ({ name, state }))
    },
    now
  );

  const data: ServerData = {
    cpu,
    memory,
    disk: {
      used: disk.used,
      total: disk.total,
      percentage: disk.percentage,
      hoursToFull: diskHoursToFull
    },
    disks: disk.mounts,
    network,
    temperature,
    fan,
    processes,
    uptime,
    host,
    load,
    swap,
    diskIO,
    gpu,
    security,
    processSummary,
    topProcessesByMemory,
    battery,
    history: getHistory(now),
    alerts,
    timestamp: new Date(now).toISOString(),
    ...(warnings.length > 0 ? { warnings } : {})
  };

  cachedData = data;
  lastUpdateTime = now;

  return data;
}

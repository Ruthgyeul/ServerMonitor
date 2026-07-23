import os from 'os';
import { readFile, readdir } from 'fs/promises';

import {
  ServerData,
  Process,
  X86TemperatureInfo,
  ARMTemperatureInfo,
  TemperatureInfo,
  TemperatureValue,
  SecurityInfo
} from '@/types/system';
import { collect, readSys, round, run } from '@/utils/collectors/shell';
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
import { getHistory, recordSample } from '@/utils/collectors/history';
import { evaluateAlerts } from '@/utils/collectors/alerts';

// 캐시된 시스템 정보
let cachedData: ServerData | null = null;
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000; // 1초마다 업데이트

interface CpuInfo {
  usage: number;
  cores: number;
  temperature: number | 'N/A';
  perCore: number[];
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
    collect('cpu.usage', getCpuUsage, { total: 0, perCore: [] }, warnings),
    collect<number | 'N/A'>('cpu.temperature', getCpuTemperature, 'N/A', warnings)
  ]);

  return { usage: usage.total, perCore: usage.perCore, cores: os.cpus().length, temperature };
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

  // MemAvailable 이 커널에 없으면(3.14 미만) free + buffers + cached 로 근사한다.
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

async function getDiskInfo(): Promise<DiskInfo> {
  // -P 는 긴 장치명 때문에 줄이 두 줄로 접히는 것을 막고,
  // -k 는 1K 블록으로 고정해 "20G"/"1.5T"/"800M" 단위 파싱을 없앤다.
  const stdout = await run('df -Pk /');
  const line = stdout.split('\n').pop() ?? '';
  const [, totalKb, usedKb, , percentage] = line.trim().split(/\s+/);

  const total = parseInt(totalKb, 10);
  const used = parseInt(usedKb, 10);
  if (Number.isNaN(total) || Number.isNaN(used)) {
    throw new Error(`unparsable df output: ${line}`);
  }

  const toGb = (kb: number) => round(kb / 1024 / 1024);
  return {
    used: toGb(used),
    total: toGb(total),
    percentage: parseInt(percentage.replace('%', ''), 10) || round((used / total) * 100, 1)
  };
}

// --- Network -----------------------------------------------------------

let prevNetSample: { rx: number; tx: number; at: number } | null = null;

async function getPing(): Promise<number> {
  const host = process.env.PING_HOST || '8.8.8.8';
  if (!/^[a-zA-Z0-9.:-]+$/.test(host)) {
    throw new Error(`invalid PING_HOST: ${host}`);
  }

  // -W 1: 응답이 없을 때 기본 10초를 기다리며 요청 전체를 붙잡는 것을 막는다.
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

  // 이전 샘플과의 실제 경과 시간으로 나눈다. 폴링 간격이 정확히 1초라고
  // 가정하면 요청이 밀릴 때마다 속도가 부풀려진다.
  let download = 0;
  let upload = 0;
  if (previous) {
    const elapsedSeconds = (now - previous.at) / 1000;
    if (elapsedSeconds > 0) {
      // 카운터가 리셋(재부팅/인터페이스 교체)되면 음수가 나오므로 0으로 막는다.
      download = Math.max(0, (rxBytes - previous.rx) / 1024 / elapsedSeconds);
      upload = Math.max(0, (txBytes - previous.tx) / 1024 / elapsedSeconds);
    }
  }

  // 에러율은 바이트가 아니라 패킷 대비로 계산해야 의미가 있다.
  const rate = (errors: number, packets: number) => (packets > 0 ? ((errors / packets) * 100).toFixed(2) : '0.00');

  const [ping, interfaces] = await Promise.all([
    collect('network.ping', getPing, 0, warnings),
    collect('network.interfaces', () => getInterfaces(interfaceName), [], warnings)
  ]);

  const linkSpeedMbps = interfaces.find(entry => entry.isDefault)?.speedMbps ?? null;
  // 링크 속도(Mbps)를 KB/s 로 바꿔 현재 처리량과 같은 단위로 비교한다.
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
      linkCapacityKbps === null ? 0 : round(Math.min(100, ((download + upload) / linkCapacityKbps) * 100), 1)
  };
}

// --- Temperature / Fan -------------------------------------------------

async function readSensors(): Promise<string> {
  return run('sensors');
}

// lm-sensors 가 없는 서버(대부분의 VPS/컨테이너)를 위한 sysfs 대체 경로.
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
    // sensors 미설치. 아래 sysfs 경로로 넘어간다.
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

// lm-sensors 가 없으면 hwmon 의 fan*_input 을 직접 읽는다.
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
    // sensors 미설치. hwmon 으로 넘어간다.
  }

  const [cpu = 0, case1 = 0, case2 = 0] = await readHwmonFans();
  return { cpu, case1, case2 };
}

// --- Processes / Uptime ------------------------------------------------

async function getProcesses(): Promise<Process[]> {
  // `args`(전체 명령줄) 대신 `comm`(실행 파일명)만 읽는다. 명령줄 인자에는
  // 비밀번호/토큰이 그대로 노출되는 경우가 많은데(예: `mysql -pSECRET`,
  // `--api-key=...`), 이 목록은 API 로도 나가므로 실행 파일명이면 충분하고 안전하다.
  // 파이프라인의 종료 코드는 head 의 것이라 ps 가 실패해도 0 이 된다.
  // 빈 출력을 그대로 넘기면 원인 없이 목록만 비므로 여기서 에러로 올린다.
  const stdout = await run('ps -eo pid,pcpu,pmem,stat,comm --sort=-pcpu | head -n 21');
  const lines = stdout.split('\n').slice(1); // 헤더 제거
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

async function getUptime(): Promise<UptimeInfo> {
  // `uptime -p` 는 busybox 에 없고 출력이 로케일을 탄다. os.uptime() 이 안전하다.
  const seconds = os.uptime();
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60)
  };
}

// --- Security ----------------------------------------------------------

async function getSecurityInfo(
  peers: Map<string, number>,
  warnings: string[]
): Promise<SecurityInfo> {
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

  // 연결 수, 열린 포트, 상위 트래픽 피어는 모두 같은 소켓 목록에서 나온다.
  // 한 번만 읽어 네트워크/보안 수집기가 나눠 쓴다.
  const sockets = await collect(
    'network.sockets',
    getSocketSummary,
    { connections: 0, listeningPorts: 0, peers: new Map<string, number>() },
    warnings
  );

  // Promise.all 이 아니라 개별 fallback 으로 감싼다. 예전에는 수집기 하나만
  // 실패해도 전체 응답이 0으로 떨어졌다.
  const [cpu, memory, disk, network, temperature, fan, processes, uptime, host, swap, diskIO, gpu] =
    await Promise.all([
      getCpuInfo(warnings),
      collect('memory', getMemoryInfo, { used: 0, total: 0, percentage: 0 }, warnings),
      collect('disk', getDiskInfo, { used: 0, total: 0, percentage: 0 }, warnings),
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
          bandwidthPercentage: 0
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
          rebootReason: null
        },
        warnings
      ),
      collect('swap', getSwapInfo, { used: 0, total: 0, percentage: 0 }, warnings),
      collect('diskIO', getDiskIo, { read: 0, write: 0 }, warnings),
      collect(
        'gpu',
        getGpuInfo,
        { name: null, usage: 'N/A' as const, temperature: 'N/A' as const },
        warnings
      )
    ]);

  const load = getLoadAverage();
  const security = await getSecurityInfo(sockets.peers, warnings);

  recordSample(cpu.usage, load.avg1, now);

  const alerts = evaluateAlerts(
    {
      cpu: cpu.usage,
      memory: memory.percentage,
      disk: disk.percentage,
      swap: swap.percentage,
      temperature: cpu.temperature,
      firewall: security.firewall.status,
      sshSessions: security.sshSessions
    },
    now
  );

  const data: ServerData = {
    cpu,
    memory,
    disk,
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
    history: getHistory(now),
    alerts,
    timestamp: new Date(now).toISOString(),
    ...(warnings.length > 0 ? { warnings } : {})
  };

  cachedData = data;
  lastUpdateTime = now;

  return data;
}

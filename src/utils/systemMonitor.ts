import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { readFile, readdir } from 'fs/promises';

import { ServerData, Process, X86TemperatureInfo, ARMTemperatureInfo, TemperatureInfo, TemperatureValue } from '@/types/system';

const execFile = promisify(exec);

// 캐시된 시스템 정보
let cachedData: ServerData | null = null;
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000; // 1초마다 업데이트

// `ip`, `sensors`, `ps` 등은 /usr/sbin, /sbin 에 설치되는 경우가 많은데
// 비-root 사용자로 뜬 systemd/pm2 서비스의 PATH 에는 그 경로가 빠져 있다.
// 그래서 명령이 "not found" 로 끝나고, 지표가 통째로 0 이 된다.
const EXEC_ENV = {
  ...process.env,
  PATH: [process.env.PATH, '/usr/local/sbin', '/usr/sbin', '/sbin'].filter(Boolean).join(':'),
  LC_ALL: 'C', // 로케일에 따라 소수점이 ','가 되면 parseFloat가 잘라먹는다
  LANG: 'C'
};

async function run(command: string): Promise<string> {
  const { stdout } = await execFile(command, { env: EXEC_ENV, timeout: 5000 });
  return stdout.trim();
}

async function readSys(filePath: string): Promise<string | null> {
  try {
    return (await readFile(filePath, 'utf-8')).trim();
  } catch {
    return null;
  }
}

// 수집기 하나가 실패해도 나머지 지표는 살려 보낸다.
async function collect<T>(name: string, fn: () => Promise<T>, fallback: T, warnings: string[]): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${name}: ${message}`);
    console.warn(`[systemMonitor] ${name} failed:`, message);
    return fallback;
  }
}

interface CpuInfo {
  usage: number;
  cores: number;
  temperature: number | 'N/A';
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

// `top -bn1` 의 첫 샘플은 부팅 이후 누적 평균이라 항상 0에 가깝게 나온다.
// /proc/stat 를 두 번 읽어 그 사이의 변화량으로 계산한다.
let prevCpuStat: { idle: number; total: number } | null = null;

async function readCpuStat(): Promise<{ idle: number; total: number }> {
  const contents = await readFile('/proc/stat', 'utf-8');
  const line = contents.split('\n').find(l => l.startsWith('cpu '));
  if (!line) throw new Error('no "cpu" line in /proc/stat');

  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 4 || values.some(Number.isNaN)) {
    throw new Error(`unparsable /proc/stat cpu line: ${line}`);
  }

  const idle = values[3] + (values[4] ?? 0); // idle + iowait
  const total = values.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

async function getCpuUsage(): Promise<number> {
  let previous = prevCpuStat;

  // 첫 호출이면 짧게 두 번 재서 0% 를 반환하지 않도록 한다.
  if (!previous) {
    previous = await readCpuStat();
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const current = await readCpuStat();
  prevCpuStat = current;

  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return 0;

  const usage = (1 - idleDelta / totalDelta) * 100;
  return parseFloat(Math.min(100, Math.max(0, usage)).toFixed(1));
}

async function getCpuInfo(warnings: string[]): Promise<CpuInfo> {
  const [usage, temperature] = await Promise.all([
    collect('cpu.usage', getCpuUsage, 0, warnings),
    collect<number | 'N/A'>('cpu.temperature', getCpuTemperature, 'N/A', warnings)
  ]);

  return { usage, cores: os.cpus().length, temperature };
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
    percentage: parseFloat(((usedKb / totalKb) * 100).toFixed(1))
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

  const toGb = (kb: number) => parseFloat((kb / 1024 / 1024).toFixed(2));
  return {
    used: toGb(used),
    total: toGb(total),
    percentage: parseInt(percentage.replace('%', ''), 10) || parseFloat(((used / total) * 100).toFixed(1))
  };
}

// --- Network -----------------------------------------------------------

// Linux network interface names are restricted to this charset (see netdevice(7)).
// Validating against it before touching sysfs paths keeps a value derived from
// command output from ever being treated as a path traversal.
const INTERFACE_NAME_PATTERN = /^[a-zA-Z0-9@.:_-]+$/;

let prevNetSample: { rx: number; tx: number; at: number } | null = null;

async function readInterfaceStat(interfaceName: string, stat: string): Promise<number> {
  const contents = await readSys(`/sys/class/net/${interfaceName}/statistics/${stat}`);
  const value = contents === null ? NaN : parseInt(contents, 10);
  return Number.isNaN(value) ? 0 : value;
}

// `ip route` 는 /usr/sbin 에 있어 서비스 PATH 에서 빠지기 쉽다.
// /proc/net/route 를 직접 읽으면 외부 바이너리가 전혀 필요 없다.
async function getDefaultInterface(): Promise<string> {
  const contents = await readFile('/proc/net/route', 'utf-8');
  const lines = contents.split('\n').slice(1);

  for (const line of lines) {
    const [iface, destination] = line.trim().split(/\s+/);
    if (destination === '00000000' && iface && INTERFACE_NAME_PATTERN.test(iface)) {
      return iface;
    }
  }

  // 기본 경로가 없으면(컨테이너 등) 트래픽이 가장 많은 물리 인터페이스로 대체한다.
  const candidates = (await readdir('/sys/class/net')).filter(
    name => name !== 'lo' && INTERFACE_NAME_PATTERN.test(name)
  );
  let best = '';
  let bestBytes = -1;
  for (const name of candidates) {
    const bytes = await readInterfaceStat(name, 'rx_bytes');
    if (bytes > bestBytes) {
      best = name;
      bestBytes = bytes;
    }
  }

  if (!best) throw new Error('no usable network interface found');
  return best;
}

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

async function getNetworkInfo(warnings: string[]): Promise<NetworkInfo> {
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

  const ping = await collect('network.ping', getPing, 0, warnings);

  return {
    download: parseFloat(download.toFixed(2)),
    upload: parseFloat(upload.toFixed(2)),
    ping,
    errorRates: {
      rx: rate(rxErrors, rxPackets),
      tx: rate(txErrors, txPackets)
    }
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

    const celsius = parseFloat((milliCelsius / 1000).toFixed(1));
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
  // 파이프라인의 종료 코드는 head 의 것이라 ps 가 실패해도 0 이 된다.
  // 빈 출력을 그대로 넘기면 원인 없이 목록만 비므로 여기서 에러로 올린다.
  const stdout = await run('ps -eo pid,pcpu,pmem,stat,args --sort=-pcpu | head -n 21');
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

  // Promise.all 이 아니라 개별 fallback 으로 감싼다. 예전에는 수집기 하나만
  // 실패해도 전체 응답이 0으로 떨어졌다.
  const [cpu, memory, disk, network, temperature, fan, processes, uptime] = await Promise.all([
    getCpuInfo(warnings),
    collect('memory', getMemoryInfo, { used: 0, total: 0, percentage: 0 }, warnings),
    collect('disk', getDiskInfo, { used: 0, total: 0, percentage: 0 }, warnings),
    collect(
      'network',
      () => getNetworkInfo(warnings),
      { download: 0, upload: 0, ping: 0, errorRates: { rx: '0.00', tx: '0.00' } },
      warnings
    ),
    collect('temperature', getTemperature, emptyTemperature(), warnings),
    collect('fan', getFanSpeed, { cpu: 0, case1: 0, case2: 0 }, warnings),
    collect<Process[]>('processes', getProcesses, [], warnings),
    collect('uptime', getUptime, { days: 0, hours: 0, minutes: 0 }, warnings)
  ]);

  const data: ServerData = {
    cpu,
    memory,
    disk,
    network,
    temperature,
    fan,
    processes,
    uptime,
    ...(warnings.length > 0 ? { warnings } : {})
  };

  cachedData = data;
  lastUpdateTime = now;

  return data;
}

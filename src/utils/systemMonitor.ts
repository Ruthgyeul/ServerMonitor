import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { readFile } from 'fs/promises';

import { isValidServerData } from '@/utils/validation';
import { ServerData, Process, X86TemperatureInfo, ARMTemperatureInfo, TemperatureValue, TemperatureInfo, isX86TemperatureInfo, isARMTemperatureInfo } from '@/types/system';

const execAsync = promisify(exec);

// 캐시된 시스템 정보
let cachedData: ServerData | null = null;
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000; // 1초마다 업데이트
let isUpdating = false; // 업데이트 중복 방지
let cachedArchitecture: 'x86' | 'arm' | 'unknown' | null = null; // 아키텍처 캐시

// 네트워크 통계 저장
let prevRxBytes = 0;
let prevTxBytes = 0;

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

// 아키텍처 감지 함수
async function getArchitecture(): Promise<'x86' | 'arm' | 'unknown'> {
    if (cachedArchitecture !== null) {
        return cachedArchitecture;
    }
    
    const { stdout } = await execAsync('uname -m');
    const arch = stdout.trim();
    
    if (arch === 'x86_64' || arch === 'i686') {
        cachedArchitecture = 'x86';
    } else if (arch === 'aarch64' || arch === 'armv7l') {
        cachedArchitecture = 'arm';
    } else {
        cachedArchitecture = 'unknown';
    }
    
    return cachedArchitecture;
}

async function getCpuInfo(): Promise<CpuInfo> {
    const { stdout } = await execAsync('top -bn1 | grep "Cpu(s)" | awk \'{print $2}\'');
    const { stdout: cores } = await execAsync('nproc');
    const arch = await getArchitecture();
    
    let temp: number | 'N/A' = 'N/A';
    try {
        if (arch === 'x86') {
            const { stdout: x86Temp } = await execAsync('sensors | grep "Package id 0" | awk \'{print $4}\' | sed \'s/+//\' | sed \'s/°C//\'');
            if (x86Temp.trim()) {
                temp = parseFloat(x86Temp.trim());
            }
        } else {
            const { stdout: armTemp } = await execAsync('sensors | grep "cpu_thermal" | grep "temp1" | awk \'{print $2}\' | sed \'s/+//\' | sed \'s/°C//\'');
            if (armTemp.trim()) {
                temp = parseFloat(armTemp.trim());
            }
        }
    } catch (error) {
        console.warn('Failed to get CPU temperature:', error);
    }
    
    return {
        usage: parseFloat(stdout.trim()),
        cores: parseInt(cores.trim()),
        temperature: temp
    };
}

async function getMemoryInfo(): Promise<MemoryInfo> {
  const { stdout } = await execAsync('free -m | grep Mem');
  const [, total, used] = stdout.trim().split(/\s+/);
  const percentage = (parseInt(used) / parseInt(total)) * 100;
  
  return {
    used: parseInt(used),
    total: parseInt(total),
    percentage: parseFloat(percentage.toFixed(1))
  };
}

async function getDiskInfo(): Promise<DiskInfo> {
  const { stdout } = await execAsync('df -h / | tail -n 1');
  const [, total, used, , percentage] = stdout.trim().split(/\s+/);
  
  return {
    used: parseFloat(used.replace('G', '')),
    total: parseFloat(total.replace('G', '')),
    percentage: parseInt(percentage.replace('%', ''))
  };
}

// Linux network interface names are restricted to this charset (see netdevice(7)).
// Validating against it before touching sysfs paths keeps a value derived from
// command output from ever being treated as shell syntax.
const INTERFACE_NAME_PATTERN = /^[a-zA-Z0-9@.:_-]+$/;

async function readInterfaceStat(interfaceName: string, stat: string): Promise<string> {
  const contents = await readFile(`/sys/class/net/${interfaceName}/statistics/${stat}`, 'utf-8');
  return contents.trim();
}

async function getNetworkInfo(): Promise<NetworkInfo> {
  const { stdout: netInterface } = await execAsync('ip route | grep default | awk \'{print $5}\'');
  const interfaceName = netInterface.trim();

  if (!INTERFACE_NAME_PATTERN.test(interfaceName)) {
    throw new Error(`Unexpected network interface name: ${interfaceName}`);
  }

  const [rx_bytes, tx_bytes, rx_errors, tx_errors] = await Promise.all([
    readInterfaceStat(interfaceName, 'rx_bytes'),
    readInterfaceStat(interfaceName, 'tx_bytes'),
    readInterfaceStat(interfaceName, 'rx_errors'),
    readInterfaceStat(interfaceName, 'tx_errors')
  ]);
  const { stdout: ping } = await execAsync('ping -c 1 8.8.8.8 | grep "time=" | awk \'{print $7}\' | sed \'s/time=//\'');

  const currentRxBytes = parseInt(rx_bytes.trim());
  const currentTxBytes = parseInt(tx_bytes.trim());
  
  // 속도 계산 (KB/s)
  const download = prevRxBytes ? (currentRxBytes - prevRxBytes) / 1024 : 0;
  const upload = prevTxBytes ? (currentTxBytes - prevTxBytes) / 1024 : 0;
  
  // 현재 값을 이전 값으로 저장
  prevRxBytes = currentRxBytes;
  prevTxBytes = currentTxBytes;
  
  // 에러율 계산 (퍼센트)
  const rxErrorRate = ((parseInt(rx_errors.trim()) / currentRxBytes) * 100).toFixed(2);
  const txErrorRate = ((parseInt(tx_errors.trim()) / currentTxBytes) * 100).toFixed(2);
  
  return {
    download: parseFloat(download.toFixed(2)),
    upload: parseFloat(upload.toFixed(2)),
    ping: parseFloat(ping.trim()),
    errorRates: {
      rx: rxErrorRate,
      tx: txErrorRate
    }
  };
}

async function getTemperature(): Promise<TemperatureInfo> {
    const arch = await getArchitecture();
    
    try {
        const { stdout } = await execAsync('sensors');
        
        if (arch === 'x86') {
            const cpuMatch = stdout.match(/Package id 0:\s+\+(\d+\.\d+)°C/);
            const gpuMatch = stdout.match(/edge:\s+\+(\d+\.\d+)°C/);
            const mbMatch = stdout.match(/temp1:\s+\+(\d+\.\d+)°C/);
            
            const x86Temp: X86TemperatureInfo = {
                cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 'N/A',
                gpu: gpuMatch ? parseFloat(gpuMatch[1]) : 'N/A',
                motherboard: mbMatch ? parseFloat(mbMatch[1]) : 'N/A'
            };
            return x86Temp;
        } else {
            // ARM 아키텍처 (Raspberry Pi 등)
            const cpuMatch = stdout.match(/cpu_thermal-virtual-0[\s\S]*?temp1:\s*\+?([\d.]+)°C/);
            const rp1Match = stdout.match(/rp1_adc-isa-0000[\s\S]*?temp1:\s*\+?([\d.]+)°C/);
            const ssdMatch = stdout.match(/nvme-pci-0100[\s\S]*?Composite:\s*\+?([\d.]+)°C/);
            
            const armTemp: ARMTemperatureInfo = {
                cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 'N/A',
                rp1: rp1Match ? parseFloat(rp1Match[1]) : 'N/A',
                ssd: ssdMatch ? parseFloat(ssdMatch[1]) : 'N/A'
            };
            return armTemp;
        }
    } catch (error) {
        console.warn('Failed to get temperature information:', error);
        
        // 에러 발생 시 기본값 반환
        if (arch === 'x86') {
            const x86Temp: X86TemperatureInfo = {
                cpu: 'N/A' as TemperatureValue,
                gpu: 'N/A' as TemperatureValue,
                motherboard: 'N/A' as TemperatureValue
            };
            return x86Temp;
        } else {
            const armTemp: ARMTemperatureInfo = {
                cpu: 'N/A' as TemperatureValue,
                rp1: 'N/A' as TemperatureValue,
                ssd: 'N/A' as TemperatureValue
            };
            return armTemp;
        }
    }
}

async function getFanSpeed(): Promise<FanInfo> {
  const { stdout } = await execAsync('sensors');
  const cpuFan = stdout.match(/fan1:\s+(\d+)/)?.[1] || '0';
  const caseFan1 = stdout.match(/fan2:\s+(\d+)/)?.[1] || '0';
  const caseFan2 = stdout.match(/fan3:\s+(\d+)/)?.[1] || '0';
  
  return {
    cpu: parseInt(cpuFan),
    case1: parseInt(caseFan1),
    case2: parseInt(caseFan2)
  };
}

async function getProcesses(): Promise<Process[]> {
  const { stdout } = await execAsync('ps aux --sort=-%cpu | head -n 21 | tail -n 20');
  const processes = stdout.split('\n')
    .filter(line => line.trim())
    .map((line, index) => {
      // Skip header line
      if (line.includes('USER') || line.includes('PID')) {
        return null;
      }

      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) {
        console.warn(`Invalid process line format: ${line}`);
        return null;
      }

      try {
        // ps aux output fields:
        // USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
        const [user, pid, cpu, mem, , , , , , , ...commandParts] = parts;
        const command = commandParts.join(' ');

        return {
          id: index + 1,
          name: command,
          cpu: parseFloat(cpu),
          memory: parseFloat(mem),
          status: 'running' as 'running' | 'sleeping'
        };
      } catch (error) {
        console.error(`Error parsing process line: ${line}`, error);
        return null;
      }
    })
    .filter((proc): proc is NonNullable<typeof proc> => proc !== null);
  return processes;
}

async function getUptime(): Promise<UptimeInfo> {
  const { stdout } = await execAsync('uptime -p');
  const days = stdout.match(/(\d+) day/)?.[1] || '0';
  const hours = stdout.match(/(\d+) hour/)?.[1] || '0';
  const minutes = stdout.match(/(\d+) minute/)?.[1] || '0';
  
  return {
    days: parseInt(days),
    hours: parseInt(hours),
    minutes: parseInt(minutes)
  };
}

// 시스템 정보 업데이트 함수
export async function updateSystemInfo() {
    if (isUpdating) return cachedData;
    
    try {
        isUpdating = true;
        const scriptPath = path.join(process.cwd(), 'monitor.sh');
        
        // 스크립트 실행 권한 확인 및 설정
        try {
            await execAsync(`chmod +x ${scriptPath}`);
        } catch (error) {
            console.error('Error setting script permissions:', error);
        }
        
        const { stdout } = await execAsync(scriptPath);
        const parsedData = JSON.parse(stdout);
        
        // 데이터 유효성 검사
        if (!isValidServerData(parsedData)) {
            throw new Error('Invalid server data format');
        }
        
        cachedData = parsedData;
        lastUpdateTime = Date.now();
        return cachedData;
    } catch (error) {
        console.error('Error updating system data:', error);
        return null;
    } finally {
        isUpdating = false;
    }
}

// 시스템 정보 가져오기
export async function getSystemInfo(): Promise<ServerData> {
    const now = Date.now();
    
    if (cachedData && now - lastUpdateTime < UPDATE_INTERVAL) {
        return cachedData;
    }
    
    try {
        const [cpu, memory, disk, network, temperature, fan, processes, uptime] = await Promise.all([
            getCpuInfo(),
            getMemoryInfo(),
            getDiskInfo(),
            getNetworkInfo(),
            getTemperature(),
            getFanSpeed(),
            getProcesses(),
            getUptime()
        ]);
        
        const data: ServerData = {
            cpu,
            memory,
            disk,
            network,
            temperature,
            fan,
            processes,
            uptime
        };
        
        cachedData = data;
        lastUpdateTime = now;
        
        return data;
    } catch (error) {
        console.error('Error updating system data:', error);
        if (cachedData) {
            return cachedData;
        }
        throw error;
    }
}

// 기본 서버 데이터
function getDefaultServerData(): ServerData {
    return {
        cpu: { usage: 0, cores: 0, temperature: 'N/A' },
        memory: { used: 0, total: 0, percentage: 0 },
        disk: { used: 0, total: 0, percentage: 0 },
        network: { 
            download: 0, 
            upload: 0, 
            ping: 0,
            errorRates: {
                rx: '0',
                tx: '0'
            }
        },
        uptime: { days: 0, hours: 0, minutes: 0 },
        temperature: { cpu: 'N/A', gpu: 'N/A', motherboard: 'N/A' },
        fan: { cpu: 0, case1: 0, case2: 0 },
        processes: []
    };
} 
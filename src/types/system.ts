export interface Process {
    id: number;
    name: string;
    cpu: number;
    memory: number;
    status: 'running' | 'sleeping';
}

// 온도 값 타입
export type TemperatureValue = number | 'N/A';

// x86 아키텍처용 온도 정보
export interface X86TemperatureInfo {
    cpu: TemperatureValue;
    gpu: TemperatureValue;
    motherboard: TemperatureValue;
}

// ARM 아키텍처용 온도 정보
export interface ARMTemperatureInfo {
    cpu: TemperatureValue;
    rp1: TemperatureValue;
    ssd: TemperatureValue;
}

// 온도 정보 (아키텍처별)
export type TemperatureInfo = X86TemperatureInfo | ARMTemperatureInfo;

// 온도 정보 타입 가드
export function isX86TemperatureInfo(temp: TemperatureInfo): temp is X86TemperatureInfo {
    return 'gpu' in temp && 'motherboard' in temp;
}

export function isARMTemperatureInfo(temp: TemperatureInfo): temp is ARMTemperatureInfo {
    return 'rp1' in temp && 'ssd' in temp;
}

// 호스트 식별 정보. 헤더의 "Ubuntu 22.04 · 5.15.0" 표기와 재부팅 이력에 쓰인다.
export interface HostInfo {
    hostname: string;
    os: string;
    kernel: string;
    arch: string;
    bootTime: string; // ISO 8601
    // 마지막 재부팅이 정상 종료였는지. wtmp 를 못 읽으면 null.
    rebootReason: string | null;
}

export interface LoadInfo {
    avg1: number;
    avg5: number;
    avg15: number;
}

export interface SwapInfo {
    used: number;  // GB
    total: number; // GB
    percentage: number;
}

export interface DiskIoInfo {
    read: number;  // MB/s
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

// 대역폭 상위 피어. nf_conntrack 의 바이트 계정이 꺼져 있으면 bytes 는 null 이고
// 연결 수(connections)만 의미가 있다.
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
    // 커널 로그를 읽을 권한이 없으면 null.
    blockedAttempts: number | null;
}

export interface SecurityInfo {
    firewall: FirewallInfo;
    sshSessions: SshSession[];
    topTraffic: TrafficPeer[];
}

export type AlertLevel = 'ok' | 'info' | 'warning' | 'critical';

export interface AlertEntry {
    id: string;
    level: AlertLevel;
    message: string;
    at: string; // ISO 8601
}

// 히스토리는 프로세스 메모리에 쌓이고 data/history.json 으로 영속화된다. 재시작해도
// 복구되지만, 서버가 꺼져 있던 구간은 값이 없어 UI 가 "수집 중" 으로 표시한다.
export interface LoadSample {
    at: string; // ISO 8601, 1시간 버킷의 시작
    // 서버가 그 시간대에 켜져 있지 않았으면 null.
    avg1: number | null;
}

export interface CpuHourSample {
    at: string; // ISO 8601, 정시 버킷의 시작
    usage: number | null;
}

export interface HistoryInfo {
    load: LoadSample[];      // 최근 48시간, 1시간 버킷
    cpuHourly: CpuHourSample[]; // 최근 24시간, 1시간 버킷
}

export interface ServerData {
    cpu: {
        usage: number;
        cores: number;
        temperature: TemperatureValue;
        // 코어별 사용률. /proc/stat 를 못 읽으면 빈 배열.
        perCore?: number[];
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
    };
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
    // 아래 필드들은 1.3 에서 추가됐다. 구버전을 돌리는 클러스터 노드도 같은
    // 대시보드로 읽을 수 있어야 하므로 전부 optional 이다.
    host?: HostInfo;
    load?: LoadInfo;
    swap?: SwapInfo;
    diskIO?: DiskIoInfo;
    gpu?: GpuInfo;
    security?: SecurityInfo;
    history?: HistoryInfo;
    alerts?: AlertEntry[];
    timestamp?: string;
    // 일부 수집기만 실패했을 때 어떤 지표가 왜 비었는지 알려준다.
    // 헤드리스 서버에서 `curl localhost:3000/api/system` 만으로 진단할 수 있게 하는 용도.
    warnings?: string[];
}

export interface NetworkHistoryEntry {
    time: string;
    download: number;
    upload: number;
} 
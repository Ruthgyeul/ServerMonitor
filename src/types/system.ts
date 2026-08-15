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
    // 가상화/컨테이너 종류(kvm/docker/lxc 등). 베어메탈이거나 감지 불가면 null.
    virtualization?: string | null;
}

export interface LoadInfo {
    avg1: number;
    avg5: number;
    avg15: number;
    // 지금 이 순간 실행 중이거나 실행을 기다리는 커널 엔티티 수.
    // /proc/loadavg 4번째 필드(running/total)의 앞쪽 값으로, 부하 평균과 같은
    // 단위의 "순간값" 이다. /proc 가 없는 OS 에서는 null.
    running: number | null;
    // 커널은 1/5/15분 평균만 준다. 30분은 우리가 매초 남기는 샘플로 직접 낸다.
    // 아직 30분이 안 찼으면 모인 만큼의 평균이고, 샘플이 없으면 null.
    avg30: number | null;
    // avg30 이 실제로 덮는 구간(초). 1800 보다 작으면 아직 창이 덜 찬 것이다.
    avg30WindowSeconds: number;
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

// 개별 마운트된 파일시스템의 사용량. 루트(/) 외에 데이터 볼륨이 따로 붙은
// 서버에서도 실제 사용량을 볼 수 있게 한다.
export interface DiskMount {
    mount: string;
    used: number;  // GB
    total: number; // GB
    percentage: number;
}

// 배터리/UPS 상태. Pi·노트북·UPS 연결 서버에 유의미하고, 없으면 null.
export interface BatteryInfo {
    percentage: number;
    status: string; // Charging / Discharging / Full / Not charging / Unknown
}

// 전체 프로세스 요약. top 목록(상위 20)과 달리 시스템 전체 규모를 센다.
export interface ProcessSummary {
    total: number;
    running: number;
    sleeping: number;
    zombie: number;
    // 스레드 포함 전체 태스크 수. /proc/loadavg 로 얻으며 없으면 null.
    threads: number | null;
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
        // 아래는 선택적(구버전 노드 호환). iowait/steal 은 %, frequencyMhz 는 평균 MHz.
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
    };
    // 루트 외 마운트를 포함한 전체 파일시스템 목록(선택적: 구버전 노드 호환).
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
        // 부팅 이후 누적 바이트(선택적: 구버전 노드 호환).
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
    // 아래 필드들은 1.3 에서 추가됐다. 구버전을 돌리는 클러스터 노드도 같은
    // 대시보드로 읽을 수 있어야 하므로 전부 optional 이다.
    host?: HostInfo;
    load?: LoadInfo;
    swap?: SwapInfo;
    diskIO?: DiskIoInfo;
    gpu?: GpuInfo;
    security?: SecurityInfo;
    // 전체 프로세스 요약 / 메모리 상위 프로세스 / 배터리(선택적: 구버전 노드 호환).
    processSummary?: ProcessSummary;
    topProcessesByMemory?: Process[];
    battery?: BatteryInfo | null;
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
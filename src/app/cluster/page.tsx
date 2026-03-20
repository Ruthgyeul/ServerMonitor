'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Cpu, HardDrive, MemoryStick, Network, Thermometer, Fan, Clock, Activity } from 'lucide-react';

import { Header } from '@/components/common/Header';
import Loading from '@/app/loading';
import { NetworkChart } from '@/components/charts/NetworkChart';

interface Server {
    name: string;
    ip: string;
    type: 'intel' | 'rpi';
}

interface Uptime {
    days: number;
    hours: number;
    minutes: number;
}

interface Memory {
    used: number;
    total: number;
    percentage: number;
}

interface Disk {
    used: number;
    total: number;
    percentage: number;
}

interface NetworkData {
    ping: number;
    download: number;
    upload: number;
    errorRates: {
        rx: string;
        tx: string;
    };
}

interface Temperature {
    cpu?: number;
    rp1?: number;
    ssd?: number;
}

interface Fan {
    cpu: number;
    case1: number;
    case2: number;
}

interface Process {
    name: string;
}

interface ServerData {
    cpu?: {
        usage: number;
        cores: number;
    };
    memory?: Memory;
    disk?: Disk;
    network?: NetworkData;
    temperature?: Temperature;
    fan?: Fan;
    uptime?: Uptime;
    processes?: Process[];
    error?: string;
}

interface ServersData {
    [key: string]: ServerData;
}

interface NetworkHistoryEntry {
    time: string;
    download: number;
    upload: number;
}

interface PieChartProps {
    percentage: number;
    size?: number;
    strokeWidth?: number;
    color: string;
}

interface ServerCardProps {
    server: Server;
    data: ServerData | undefined;
}

const ClusterPage = () => {
    const [serversData, setServersData] = useState<ServersData>({});
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState(new Date());
    const [networkHistory, setNetworkHistory] = useState<{ [key: string]: NetworkHistoryEntry[] }>({});

    // 메모이제이션된 서버 목록
    const servers = useMemo(() => [
        { name: 'RuthServer', ip: '192.168.0.100', type: 'intel' as const },
        { name: 'RuthPiMaster', ip: '192.168.0.200', type: 'rpi' as const },
        { name: 'RuthPiNode1', ip: '192.168.0.201', type: 'rpi' as const },
        { name: 'RuthPiNode2', ip: '192.168.0.202', type: 'rpi' as const }
    ], []);

    // 메모리 관리를 위한 cleanup 함수
    const cleanupNetworkHistory = useCallback(() => {
        setNetworkHistory(prev => {
            const newHistory = { ...prev };
            for (const serverIp in newHistory) {
                if (newHistory[serverIp].length > 30) {
                    newHistory[serverIp] = newHistory[serverIp].slice(-30);
                }
            }
            return newHistory;
        });
    }, []);

    const updateNetworkHistory = useCallback((serverIp: string, networkData: NetworkData | undefined) => {
        const now = new Date();
        const time = now.toLocaleTimeString('ko-KR', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: false 
        });
        
        setNetworkHistory(prev => {
            const serverHistory = prev[serverIp] || [];
            const newHistory = [
                ...serverHistory,
                {
                    time,
                    download: networkData?.download || 0,
                    upload: networkData?.upload || 0
                }
            ];
            return {
                ...prev,
                [serverIp]: newHistory.slice(-30)
            };
        });
    }, []);

    const fetchServerData = useCallback(async () => {
        const newData: ServersData = {};

        for (const server of servers) {
            try {
                const url = `http://${server.ip}:3000/api/system`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(url, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const serverData = await response.json();
                    newData[server.ip] = serverData;
                    updateNetworkHistory(server.ip, serverData.network);
                } else {
                    newData[server.ip] = { error: 'Failed to fetch' };
                }
            } catch (error) {
                newData[server.ip] = { error: 'Connection failed' };
            }
        }

        setServersData(newData);
        setLoading(false);
        setLastUpdate(new Date());
    }, [servers, updateNetworkHistory]);

    // 컴포넌트 마운트/언마운트 관리
    useEffect(() => {
        let isMounted = true;
        let mainInterval: NodeJS.Timeout;
        let cleanupInterval: NodeJS.Timeout;

        const initializeData = async () => {
            if (isMounted) {
                await fetchServerData();
                mainInterval = setInterval(fetchServerData, 1000);
                cleanupInterval = setInterval(cleanupNetworkHistory, 60000);
            }
        };

        initializeData();

        return () => {
            isMounted = false;
            clearInterval(mainInterval);
            clearInterval(cleanupInterval);
            setNetworkHistory({});
            setServersData({});
        };
    }, [fetchServerData, cleanupNetworkHistory]);

    // 메모이제이션된 상태 업데이트 함수들
    const getStatusColor = useCallback((percentage: number): string => {
        if (percentage > 80) return '#ef4444';
        if (percentage > 60) return '#f59e0b';
        return '#10b981';
    }, []);

    const formatUptime = useCallback((uptime: Uptime | undefined): string => {
        if (!uptime) return 'N/A';
        const { days, hours, minutes } = uptime;
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }, []);

    const formatMemory = useCallback((memory: Memory | undefined): string => {
        if (!memory) return 'N/A';
        const usedGB = (memory.used / 1024).toFixed(1);
        const totalGB = (memory.total / 1024).toFixed(1);
        return `${usedGB}/${totalGB}GB`;
    }, []);

    const formatDisk = useCallback((disk: Disk | undefined): string => {
        if (!disk) return 'N/A';
        const usedGB = disk.used;
        const totalGB = disk.total;
        return `${usedGB}/${totalGB}GB`;
    }, []);

    const getTemperatureDisplay = useCallback((temperature: Temperature | undefined, type: string): string | null => {
        if (!temperature) return null;

        if (type === 'n95') {
            return temperature.cpu ? `${temperature.cpu}°C` : 'N/A';
        } else {
            if (temperature.cpu) return `${temperature.cpu}°C`;
            if (temperature.rp1) return `${temperature.rp1}°C`;
            if (temperature.ssd) return `${temperature.ssd}°C`;
            return 'N/A';
        }
    }, []);

    const getFanSpeed = useCallback((fan: Fan | undefined): string | null => {
        if (!fan) return null;
        if (fan.cpu > 0) return `${fan.cpu}RPM`;
        if (fan.case1 > 0) return `${fan.case1}RPM`;
        if (fan.case2 > 0) return `${fan.case2}RPM`;
        return null;
    }, []);

    const getTempColor = useCallback((temp: number | undefined): string => {
        if (temp === undefined || temp === null) return 'text-gray-400';
        if (temp <= 50) return 'text-green-400';
        if (temp <= 65) return 'text-yellow-400';
        if (temp <= 74) return 'text-orange-400';
        return 'text-red-400';
    }, []);

    // 메모이제이션된 PieChart 컴포넌트
    const PieChart = useMemo(() => {
        function PieChartComponent({ percentage, size = 36, strokeWidth = 3, color }: PieChartProps) {
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;
            const strokeDasharray = circumference;
            const strokeDashoffset = circumference - (percentage / 100) * circumference;

            return (
                <div className="relative" style={{ width: size, height: size }}>
                    <svg
                        width={size}
                        height={size}
                        className="-rotate-90"
                    >
                        <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            stroke="#374151"
                            strokeWidth={strokeWidth}
                            fill="transparent"
                        />
                        <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            stroke={color}
                            strokeWidth={strokeWidth}
                            fill="transparent"
                            strokeDasharray={strokeDasharray}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            className="transition-all duration-300"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-lg font-mono" style={{ color }}>
                            {percentage.toFixed(0)}%
                        </span>
                    </div>
                </div>
            );
        }

        return PieChartComponent;
    }, []);

    // 메모이제이션된 ServerCard 컴포넌트
    const ServerCard = useMemo(() => {
        function ServerCardComponent({ server, data }: ServerCardProps) {
            if (!data || data.error) {
                return (
                    <div className="bg-gray-800 rounded-lg p-2 border border-gray-700 h-full flex flex-col">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-white truncate">{server.name}</h3>
                            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                        </div>
                        <div className="text-red-400 text-xs flex-1 flex items-center">
                            {data?.error || 'Offline'}
                        </div>
                    </div>
                );
            }

            const { cpu, memory, disk, network, temperature, fan, uptime, processes } = data;
            const topProcess = processes?.[0];

            return (
                <div className="bg-gray-800 rounded-lg p-2 border border-gray-700 hover:border-gray-600 transition-colors h-full flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-white truncate">{server.name}</h3>
                        <div className="flex items-center space-x-1">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="text-xs text-gray-400">{server.ip.split(':')[0]}</span>
                        </div>
                    </div>

                    {/* Main Stats Grid */}
                    <div className="grid grid-cols-2 gap-1 mb-2 flex-1">
                        {/* CPU */}
                        <div className="bg-gray-900 rounded p-1.5 flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center space-x-2">
                                    <Cpu className="w-4 h-4 text-blue-400" />
                                    <span className="text-sm text-gray-400">CPU</span>
                                </div>
                            </div>
                            <div className="flex-1 flex flex-col justify-center items-center">
                                <div className="flex items-center justify-center">
                                    <PieChart
                                        percentage={cpu?.usage || 0}
                                        size={64}
                                        strokeWidth={3}
                                        color={getStatusColor(cpu?.usage || 0)}
                                    />
                                </div>
                                <div className="text-base text-center text-gray-500 mt-1">
                                    {cpu?.cores || 0} cores
                                </div>
                            </div>
                        </div>

                        {/* Memory */}
                        <div className="bg-gray-900 rounded p-1.5 flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center space-x-2">
                                    <MemoryStick className="w-4 h-4 text-purple-400" />
                                    <span className="text-sm text-gray-400">RAM</span>
                                </div>
                            </div>
                            <div className="flex-1 flex flex-col justify-center items-center">
                                <div className="flex items-center justify-center">
                                    <PieChart
                                        percentage={memory?.percentage || 0}
                                        size={64}
                                        strokeWidth={3}
                                        color={getStatusColor(memory?.percentage || 0)}
                                    />
                                </div>
                                <div className="text-base text-center text-gray-500 mt-1">
                                    {formatMemory(memory)}
                                </div>
                            </div>
                        </div>

                        {/* Disk */}
                        <div className="bg-gray-900 rounded p-1.5 flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center space-x-2">
                                    <HardDrive className="w-4 h-4 text-green-400" />
                                    <span className="text-sm text-gray-400">Disk</span>
                                </div>
                            </div>
                            <div className="flex-1 flex flex-col justify-center items-center">
                                <div className="flex items-center justify-center">
                                    <PieChart
                                        percentage={disk?.percentage || 0}
                                        size={64}
                                        strokeWidth={3}
                                        color={getStatusColor(disk?.percentage || 0)}
                                    />
                                </div>
                                <div className="text-base text-center text-gray-500 mt-1">
                                    {formatDisk(disk)}
                                </div>
                            </div>
                        </div>

                        {/* Network */}
                        <div className="bg-gray-900 rounded p-1.5 flex flex-col">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center space-x-2">
                                    <Network className="w-4 h-4 text-cyan-400" />
                                    <span className="text-sm text-gray-400">Net</span>
                                </div>
                            </div>
                            <div className="flex-1 flex flex-col justify-center items-center">
                                <div className="text-base">
                                    <div className="text-blue-400">↓ {(data.network?.download || 0).toFixed(1)} MB/s</div>
                                    <div className="text-green-400">↑ {(data.network?.upload || 0).toFixed(1)} MB/s</div>
                                </div>
                                <div className="text-base text-gray-600">
                                    <div>RX: {network?.errorRates?.rx || '0.00'}%</div>
                                    <div>TX: {network?.errorRates?.tx || '0.00'}%</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Info */}
                    <div className="flex flex-col text-xs pt-1 border-t border-gray-700 gap-1">
                        <div className="flex items-center space-x-2">
                            {getTemperatureDisplay(temperature, server.type) && (
                                <div className="flex items-center space-x-1">
                                    <Thermometer className="w-3 h-3 text-red-400" />
                                    <span className={getTempColor(
                                        server.type === 'intel' ? temperature?.cpu :
                                        temperature?.cpu || temperature?.rp1 || temperature?.ssd
                                    )}>{getTemperatureDisplay(temperature, server.type)}</span>
                                </div>
                            )}
                            {getFanSpeed(fan) && (
                                <div className="flex items-center space-x-1">
                                    <Fan className="w-3 h-3 text-blue-400" />
                                    <span className="text-gray-400">{getFanSpeed(fan)}</span>
                                </div>
                            )}
                        </div>
                        {uptime && (
                            <div className="flex items-center space-x-1">
                                <Clock className="w-3 h-3 text-yellow-400" />
                                <span className="text-gray-400">{formatUptime(uptime)}</span>
                            </div>
                        )}
                        {topProcess && (
                            <div className="flex items-center space-x-1 max-w-20">
                                <Activity className="w-3 h-3 text-orange-400" />
                                <span className="text-gray-400 truncate text-xs">
                                    {topProcess.name.split(' ')[0].split('/').pop()}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return ServerCardComponent;
    }, [getStatusColor, formatMemory, formatDisk, getTemperatureDisplay, getFanSpeed, getTempColor, PieChart]);

    if (loading) {
        return <Loading />;
    }

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100">
            <Header error={null} />
            <div className="p-1 sm:p-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1 sm:gap-2 mb-1 sm:mb-2">
                    {servers.map((server) => (
                        <ServerCard
                            key={server.ip}
                            server={server}
                            data={serversData[server.ip]}
                        />
                    ))}
                </div>

                <div className="bg-gray-800 rounded-lg p-1 sm:p-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-2 text-center">
                        {servers.map((server) => {
                            const data = serversData[server.ip];
                            const history = networkHistory[server.ip] || [];
                            if (!data || data.error) {
                                return (
                                    <div key={server.ip} className="text-xs">
                                        <div className="text-gray-500 truncate">{server.name}</div>
                                        <div className="text-red-400">Offline</div>
                                    </div>
                                );
                            }

                            return (
                                <div key={server.ip} className="text-xs">
                                    <div className="text-gray-400 truncate mb-1">{server.name}</div>
                                    <NetworkChart data={history} minimal />
                                    <div className="text-gray-500 text-xs mt-1">
                                        {data.network?.ping?.toFixed(0) || 0}ms
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(ClusterPage);
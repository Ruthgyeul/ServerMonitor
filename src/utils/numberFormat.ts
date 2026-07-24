import { ServerData, Process, isX86TemperatureInfo } from '@/types/system';

export const formatNumber = (num: number): number => {
    return Number(num.toFixed(2));
};

export const formatTemperature = (temp: number | 'N/A'): number | 'N/A' => {
    if (temp === 'N/A') return 'N/A';
    return Number(temp.toFixed(2));
};

type FormattableValue = number | string | boolean | null | FormattableObject | FormattableArray;
interface FormattableObject {
    [key: string]: FormattableValue;
}
type FormattableArray = FormattableValue[];

export const formatServerData = (data: ServerData): ServerData => {
    if (typeof data !== 'object' || data === null) {
        return data;
    }

    const formatted: ServerData = {
        cpu: {
            usage: formatNumber(data.cpu.usage),
            cores: data.cpu.cores,
            temperature: formatTemperature(data.cpu.temperature)
        },
        memory: {
            used: formatNumber(data.memory.used),
            total: data.memory.total,
            percentage: formatNumber(data.memory.percentage)
        },
        disk: {
            used: formatNumber(data.disk.used),
            total: data.disk.total,
            percentage: formatNumber(data.disk.percentage)
        },
        network: {
            download: formatNumber(data.network.download),
            upload: formatNumber(data.network.upload),
            ping: formatNumber(data.network.ping),
            errorRates: {
                rx: data.network.errorRates.rx,
                tx: data.network.errorRates.tx
            }
        },
        uptime: {
            days: data.uptime.days,
            hours: data.uptime.hours,
            minutes: data.uptime.minutes
        },
        temperature: isX86TemperatureInfo(data.temperature) ? {
            cpu: formatTemperature(data.temperature.cpu),
            gpu: formatTemperature(data.temperature.gpu),
            motherboard: formatTemperature(data.temperature.motherboard)
        } : {
            cpu: formatTemperature(data.temperature.cpu),
            rp1: formatTemperature(data.temperature.rp1),
            ssd: formatTemperature(data.temperature.ssd)
        },
        fan: {
            cpu: formatNumber(data.fan.cpu),
            case1: formatNumber(data.fan.case1),
            case2: formatNumber(data.fan.case2)
        },
        processes: data.processes.map((process: Process) => ({
            ...process,
            cpu: formatNumber(process.cpu),
            memory: formatNumber(process.memory)
        }))
    };
    return formatted;
}; 
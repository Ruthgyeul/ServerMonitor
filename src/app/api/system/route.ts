import { NextResponse } from 'next/server';
import { getSystemInfo } from '@/utils/systemMonitor';
import { ServerData } from '@/types/system';
import { isValidServerData } from '@/utils/validation';

// 기본 서버 데이터
const defaultServerData: ServerData = {
    cpu: { usage: 0, cores: 0, temperature: 0 },
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
    temperature: { cpu: 0, gpu: 0, motherboard: 0 },
    fan: { cpu: 0, case1: 0, case2: 0 },
    processes: []
};

// 허용된 origin 목록 (.env의 ALLOWED_ORIGINS로 설정, 콤마로 구분)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

function getCorsHeaders(origin: string | undefined) {
    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };
    if (origin && allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

export async function GET(request: Request) {
    const origin = request.headers.get('origin') || undefined;

    try {
        const data = await getSystemInfo();

        // 데이터 유효성 검사
        if (!data || !isValidServerData(data)) {
            console.error('Invalid server data received');
            return new NextResponse(JSON.stringify(defaultServerData), {
                headers: getCorsHeaders(origin)
            });
        }

        return new NextResponse(JSON.stringify(data), {
            headers: getCorsHeaders(origin)
        });
    } catch (error) {
        console.error('Error fetching system data:', error);
        return new NextResponse(JSON.stringify(defaultServerData), {
            headers: getCorsHeaders(origin)
        });
    }
}

// OPTIONS 메서드 핸들링 (CORS preflight 요청 처리)
export function OPTIONS(request: Request) {
    const origin = request.headers.get('origin') || undefined;
    return new NextResponse(null, { headers: getCorsHeaders(origin) });
}
import { NextResponse } from 'next/server';
import { getSystemInfo } from '@/utils/systemMonitor';
import { isValidServerData } from '@/utils/validation';

// 수집기별 실패는 systemMonitor 안에서 각자 fallback 으로 처리되므로,
// 여기까지 올라온 에러는 진짜 고장이다. 0으로 채운 정상 응답을 돌려주면
// 대시보드에 "모든 값이 0" 으로만 보이고 원인이 감춰지므로 5xx 로 알린다.

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
            return new NextResponse(JSON.stringify({ error: 'Invalid server data received' }), {
                status: 500,
                headers: getCorsHeaders(origin)
            });
        }

        return new NextResponse(JSON.stringify(data), {
            headers: getCorsHeaders(origin)
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error fetching system data:', error);
        return new NextResponse(JSON.stringify({ error: `Failed to collect system data: ${message}` }), {
            status: 500,
            headers: getCorsHeaders(origin)
        });
    }
}

// OPTIONS 메서드 핸들링 (CORS preflight 요청 처리)
export function OPTIONS(request: Request) {
    const origin = request.headers.get('origin') || undefined;
    return new NextResponse(null, { headers: getCorsHeaders(origin) });
}
import { NextResponse } from 'next/server';
import { corsHeaders } from '@/utils/cors';
import { getSystemInfo } from '@/utils/systemMonitor';
import { isValidServerData } from '@/utils/validation';

// 수집기별 실패는 systemMonitor 안에서 각자 fallback 으로 처리되므로,
// 여기까지 올라온 에러는 진짜 고장이다. 0으로 채운 정상 응답을 돌려주면
// 대시보드에 "모든 값이 0" 으로만 보이고 원인이 감춰지므로 5xx 로 알린다.

function getCorsHeaders(origin: string | undefined) {
    // 이 라우트는 GET/OPTIONS 만 구현한다. 쓰지도 않는 메서드/헤더를 광고하지 않는다.
    return corsHeaders(origin, {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    });
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
        // 원인(파일 경로/명령 실패 메시지 등)은 서버 로그에만 남기고, 클라이언트에는
        // 내부 구조를 드러내지 않는 일반 메시지만 돌려준다.
        console.error('Error fetching system data:', error);
        return new NextResponse(JSON.stringify({ error: 'Failed to collect system data' }), {
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
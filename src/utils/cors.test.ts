import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// allowedOrigins 는 모듈 로드 시점에 env 를 읽는다. 케이스마다 새로 불러온다.
async function withOrigins(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = value;
  return import('@/utils/cors');
}

describe('corsHeaders', () => {
  beforeEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it('허용된 오리진에만 ACAO 를 붙인다', async () => {
    const { corsHeaders } = await withOrigins('https://a.example,https://b.example');

    expect(corsHeaders('https://a.example')['Access-Control-Allow-Origin']).toBe('https://a.example');
    expect(corsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('오리진이 허용되지 않아도 Vary: Origin 은 항상 붙인다', async () => {
    const { corsHeaders } = await withOrigins('https://a.example');

    // 응답이 Origin 에 따라 달라지므로, 캐시가 오리진 간에 섞지 않도록
    // ACAO 를 붙이지 않는 경우에도 Vary 가 필요하다.
    expect(corsHeaders('https://evil.example').Vary).toBe('Origin');
    expect(corsHeaders(undefined).Vary).toBe('Origin');
    expect(corsHeaders('https://a.example').Vary).toBe('Origin');
  });

  it('설정한 뒤 슬래시는 무시한다', async () => {
    // Origin 헤더에는 뒤 슬래시가 없어서, .env 에 붙어 있으면 매칭이 어긋난다.
    const { corsHeaders } = await withOrigins('https://a.example/');
    expect(corsHeaders('https://a.example')['Access-Control-Allow-Origin']).toBe('https://a.example');
  });

  it('콤마 주변 공백과 빈 항목을 견딘다', async () => {
    const { corsHeaders } = await withOrigins(' https://a.example ,, https://b.example ');

    expect(corsHeaders('https://b.example')['Access-Control-Allow-Origin']).toBe('https://b.example');
    // 빈 항목이 살아남으면 Origin 없는 요청이 통과해버린다.
    expect(corsHeaders('')['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('설정이 없으면 로컬 개발 오리진만 허용한다', async () => {
    const { corsHeaders } = await withOrigins(undefined);

    expect(corsHeaders('http://localhost:3000')['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    expect(corsHeaders('https://a.example')['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('넘긴 기본 헤더를 그대로 보존한다', async () => {
    const { corsHeaders } = await withOrigins('https://a.example');
    const headers = corsHeaders('https://a.example', { 'Content-Type': 'text/event-stream' });

    expect(headers['Content-Type']).toBe('text/event-stream');
  });
});

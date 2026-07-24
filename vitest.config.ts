import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

// 앱 코드가 '@/...' 로 임포트하므로 테스트에서도 같은 별칭을 풀어 준다.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    // 수집기는 fs/os/child_process 를 쓴다. 브라우저 환경이 필요 없다.
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});

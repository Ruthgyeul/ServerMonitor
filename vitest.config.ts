import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

// App code imports via '@/...', so resolve the same alias in tests.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    // Collectors use fs/os/child_process. No browser environment is needed.
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});

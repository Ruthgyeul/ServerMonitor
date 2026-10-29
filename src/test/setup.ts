import { beforeEach } from 'vitest';

import { resetProcessSingletons } from '@/utils/processSingleton';

// Shared per-process state (processSingleton) outlives vi.resetModules(), so
// every test starts from a clean slate the way a fresh process would.
beforeEach(() => {
  resetProcessSingletons();
});

// Next.js calls this register() once when the server boots. Starting the
// collection loop here means history/alerts accumulate from the start even if a
// browser never connects (24/7 collection). The Edge runtime can't use
// fs/child_process, so start only on the nodejs runtime.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Surface .env mistakes (bad cluster JSON, inverted alert thresholds, an
  // invalid PING_HOST, ...) once at boot instead of letting them fail silently.
  const [{ validateConfig }, { logger }] = await Promise.all([
    import('@/utils/validateConfig'),
    import('@/utils/logger')
  ]);
  for (const warning of validateConfig()) logger.warn('config:', warning);

  const { ensureCollecting } = await import('@/utils/systemStream');
  ensureCollecting();
}

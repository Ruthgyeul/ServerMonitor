// Next.js calls this register() once when the server boots. Starting the
// collection loop here means history/alerts accumulate from the start even if a
// browser never connects (24/7 collection). The Edge runtime can't use
// fs/child_process, so start only on the nodejs runtime.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureCollecting } = await import('@/utils/systemStream');
  ensureCollecting();
}

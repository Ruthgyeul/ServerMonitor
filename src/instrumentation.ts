// Next.js 는 서버가 부팅될 때 이 register() 를 한 번 호출한다. 여기서 수집
// 루프를 띄워, 브라우저가 한 번도 접속하지 않아도 히스토리/알림이 처음부터
// 쌓이게 한다(24/7 수집). Edge 런타임에서는 fs/child_process 를 못 쓰므로
// nodejs 런타임에서만 시작한다.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureCollecting } = await import('@/utils/systemStream');
  ensureCollecting();
}

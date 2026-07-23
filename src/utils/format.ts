// 대시보드 표기 전용 포맷터. 수집기는 항상 같은 단위(네트워크는 KB/s, 디스크는 GB)로
// 보내고, 사람이 읽기 좋은 단위 변환은 전부 여기서 한다.

export function formatRate(kbPerSecond: number): string {
  if (!Number.isFinite(kbPerSecond)) return '0 KB/s';
  if (kbPerSecond >= 1024) return `${(kbPerSecond / 1024).toFixed(2)} MB/s`;
  return `${kbPerSecond.toFixed(kbPerSecond >= 10 ? 0 : 1)} KB/s`;
}

// 축 눈금처럼 단위를 따로 붙여야 할 때 쓴다.
export function rateUnit(maxKbPerSecond: number): { unit: string; divisor: number } {
  return maxKbPerSecond >= 1024 ? { unit: 'MB/s', divisor: 1024 } : { unit: 'KB/s', divisor: 1 };
}

// 디스크 I/O 는 MB/s 로 들어온다. 유휴에 가까운 서버는 값이 1 MB/s 를 한참 밑돌아
// MB/s 로 반올림하면 계속 0.0 으로만 보인다. 두 값 중 큰 쪽이 1 MB/s 미만이면
// 둘 다 KB/s 로 바꿔, 단위 하나는 공유하되 실제 값이 드러나게 한다.
export function formatMbPair(readMb: number, writeMb: number): { read: string; write: string; unit: string } {
  const useKb = Math.max(readMb, writeMb) < 1;
  if (useKb) {
    const kb = (mb: number) => (mb * 1024).toFixed(mb * 1024 >= 10 ? 0 : 1);
    return { read: kb(readMb), write: kb(writeMb), unit: 'KB/s' };
  }
  return { read: readMb.toFixed(1), write: writeMb.toFixed(1), unit: 'MB/s' };
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)}${units[index]}`;
}

export function formatRelativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

export function formatClock(date: Date): string {
  const day = date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return `${day} ${time}`;
}

// "07-20 14:32" — 좁은 카드에 넣기 위해 연도는 뺀다.
export function formatShortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 커널 릴리스는 "5.15.0-101-generic" 처럼 길다. 헤더에는 버전만 남긴다.
export function shortKernel(release: string): string {
  return release.split('-')[0];
}

export function formatLinkSpeed(mbps: number | null): string {
  if (mbps === null) return 'unknown link speed';
  return mbps >= 1000 ? `${mbps / 1000}Gbps link` : `${mbps}Mbps link`;
}

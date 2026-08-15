import { DiskMount } from '@/types/system';
import { round } from '@/utils/collectors/shell';

// `df -Pk` 한 번으로 모든 마운트를 읽어, 루트(/) 외에 데이터 볼륨이 따로 붙은
// 서버에서도 실제 사용량을 볼 수 있게 한다. 파싱은 순수 함수로 떼어 테스트한다.
//
// 실 블록 장치(첫 컬럼이 /dev/ 로 시작)만 남긴다. tmpfs/devtmpfs/overlay/proc
// 같은 의사 파일시스템은 사용량이 의미가 없거나 중복 집계되므로 버린다.

const toGb = (kb: number) => round(kb / 1024 / 1024);

export function parseDf(stdout: string): DiskMount[] {
  const lines = stdout.split('\n').slice(1); // 헤더 제거
  const byMount = new Map<string, DiskMount>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Filesystem  1024-blocks  Used  Available  Capacity  Mounted-on
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const source = parts[0];
    if (!source.startsWith('/dev/')) continue;

    const totalKb = parseInt(parts[1], 10);
    const usedKb = parseInt(parts[2], 10);
    const capacity = parseInt(parts[4].replace('%', ''), 10);
    // 마운트 경로에 공백이 들어갈 수 있어 6번째 이후를 다시 합친다.
    const mount = parts.slice(5).join(' ');

    if (Number.isNaN(totalKb) || Number.isNaN(usedKb) || totalKb <= 0) continue;

    // bind 마운트 등으로 같은 장치가 여러 번 나오면 첫(대개 최상위) 것만 쓴다.
    if (byMount.has(mount)) continue;

    byMount.set(mount, {
      mount,
      used: toGb(usedKb),
      total: toGb(totalKb),
      percentage: Number.isNaN(capacity) ? round((usedKb / totalKb) * 100, 1) : capacity
    });
  }

  // 루트를 맨 앞에, 나머지는 사용률 높은 순으로.
  return [...byMount.values()].sort((a, b) => {
    if (a.mount === '/') return -1;
    if (b.mount === '/') return 1;
    return b.percentage - a.percentage;
  });
}

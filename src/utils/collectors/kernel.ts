import { run, withTtl } from '@/utils/collectors/shell';

// Two journal-derived security/health counters, both over the last 24h:
//   - kernel errors (priority err) — OOM kills, I/O errors, hardware faults that
//     never show on a CPU/load graph.
//   - failed SSH logins — a brute-force indicator.
// Reading the journal is expensive, so each is cached for a minute. A null count
// means the journal wasn't readable (no permission), distinct from a real 0.

// Pure: count non-empty lines (used for the kernel error tally).
export function countNonEmptyLines(output: string): number {
  return output.split('\n').filter(line => line.trim() !== '').length;
}

// Pure: count failed-authentication lines in sshd journal output.
export function countFailedLogins(output: string): number {
  let count = 0;
  for (const line of output.split('\n')) {
    if (/Failed password|authentication failure|Invalid user|Failed publickey/i.test(line)) count += 1;
  }
  return count;
}

export const getKernelErrorCount = withTtl(60_000, async (): Promise<number | null> => {
  try {
    // -p 3 = err priority. No `|| true`, so a permission failure throws → null.
    const output = await run('journalctl -k -p 3 --since=-24h --no-pager -n 2000 2>/dev/null', 10_000);
    return countNonEmptyLines(output);
  } catch {
    return null;
  }
});

export const getFailedLoginCount = withTtl(60_000, async (): Promise<number | null> => {
  try {
    const output = await run(
      'journalctl _SYSTEMD_UNIT=ssh.service _SYSTEMD_UNIT=sshd.service --since=-24h --no-pager -n 5000 2>/dev/null',
      10_000
    );
    return countFailedLogins(output);
  } catch {
    return null;
  }
});

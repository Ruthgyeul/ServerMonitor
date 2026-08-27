import { describe, expect, it } from 'vitest';

import { countFailedLogins, countNonEmptyLines } from '@/utils/collectors/kernel';

describe('countNonEmptyLines', () => {
  it('counts non-empty lines', () => {
    expect(countNonEmptyLines('a\n\nb\n')).toBe(2);
    expect(countNonEmptyLines('')).toBe(0);
  });
});

describe('countFailedLogins', () => {
  it('counts failed-auth lines and ignores others', () => {
    const output = [
      'sshd[123]: Failed password for root from 10.0.0.1 port 2222 ssh2',
      'sshd[124]: Accepted password for deploy from 10.0.0.2',
      'sshd[125]: Invalid user admin from 10.0.0.3',
      'sshd[126]: pam_unix(sshd:auth): authentication failure; rhost=10.0.0.4'
    ].join('\n');
    expect(countFailedLogins(output)).toBe(3);
  });

  it('returns 0 for clean output', () => {
    expect(countFailedLogins('sshd: Accepted publickey for deploy')).toBe(0);
  });
});

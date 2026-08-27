import { describe, expect, it } from 'vitest';

import { parseOsRelease, parseRebootReason } from '@/utils/collectors/host';

describe('parseOsRelease', () => {
  it('parses key=value pairs and strips surrounding quotes', () => {
    const fields = parseOsRelease('NAME="Ubuntu"\nVERSION_ID="22.04"\nPRETTY_NAME="Ubuntu 22.04.4 LTS"');
    expect(fields.NAME).toBe('Ubuntu');
    expect(fields.VERSION_ID).toBe('22.04');
    expect(fields.PRETTY_NAME).toBe('Ubuntu 22.04.4 LTS');
  });

  it('ignores comments and blank lines', () => {
    expect(parseOsRelease('# comment\n\nID=debian')).toEqual({ ID: 'debian' });
  });
});

describe('parseRebootReason', () => {
  it('reports a clean shutdown when a shutdown record precedes the reboot', () => {
    const output = [
      'reboot   system boot  6.5.0    Sat Jul 20 14:00',
      'shutdown system down  6.5.0    Sat Jul 20 13:59',
      'reboot   system boot  6.5.0    Fri Jul 19 09:00'
    ].join('\n');
    expect(parseRebootReason(output)).toBe('clean shutdown');
  });

  it('reports an unexpected shutdown when no shutdown record precedes it', () => {
    const output = [
      'reboot   system boot  6.5.0    Sat Jul 20 14:00',
      'reboot   system boot  6.5.0    Fri Jul 19 09:00'
    ].join('\n');
    expect(parseRebootReason(output)).toBe('unexpected shutdown');
  });

  it('returns null when there is no reboot record', () => {
    expect(parseRebootReason('')).toBeNull();
  });
});

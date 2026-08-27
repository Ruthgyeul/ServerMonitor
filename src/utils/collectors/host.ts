import os from 'os';

import { HostInfo } from '@/types/system';
import { readSys, run, withTtl } from '@/utils/collectors/shell';

export function parseOsRelease(contents: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return fields;
}

// The distro name doesn't change while booted. Reading it once is enough.
const readDistro = withTtl(60 * 60 * 1000, async (): Promise<string> => {
  const contents = (await readSys('/etc/os-release')) ?? (await readSys('/usr/lib/os-release'));
  if (!contents) return `${os.type()} ${os.release()}`;

  const fields = parseOsRelease(contents);
  // PRETTY_NAME like "Ubuntu 22.04.4 LTS" is too long for the narrow header.
  // NAME + VERSION_ID ("Ubuntu 22.04") is shorter with the same information.
  if (fields.NAME && fields.VERSION_ID) return `${fields.NAME} ${fields.VERSION_ID}`;
  return fields.PRETTY_NAME || fields.NAME || `${os.type()} ${os.release()}`;
});

// Scans wtmp to see whether there was a clean shutdown record right before the
// last reboot. If so it was a planned reboot; if not it was an unexpected
// shutdown like a kernel panic or power loss.
// Pure: given `last -x` output, decide whether the last boot followed a clean
// shutdown record. Split out so the log walking can be unit-tested.
export function parseRebootReason(output: string): string | null {
  const lines = output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const rebootIndex = lines.findIndex(line => line.startsWith('reboot'));
  if (rebootIndex === -1) return null;

  const previous = lines[rebootIndex + 1];
  if (!previous) return null;
  return previous.startsWith('shutdown') ? 'clean shutdown' : 'unexpected shutdown';
}

const readRebootReason = withTtl(5 * 60 * 1000, async (): Promise<string | null> => {
  let output: string;
  try {
    output = await run('last -x -F -n 20 reboot shutdown 2>/dev/null || true');
  } catch {
    return null; // `last` not installed (busybox, etc.) or no wtmp permission
  }
  return parseRebootReason(output);
});

// Virtualization/container kind. Some metrics (steal, temperature, fan) read
// differently from bare metal, so note the environment it runs in.
// systemd-detect-virt exits 1 when there's none, hence || true. The value
// doesn't change while booted, so cache it for a long time.
const readVirtualization = withTtl(60 * 60 * 1000, async (): Promise<string | null> => {
  try {
    const output = await run('systemd-detect-virt 2>/dev/null || true');
    const value = output.trim();
    // "none" is bare metal. An empty string means the tool isn't installed — neither is shown.
    if (!value || value === 'none') return null;
    return value;
  } catch {
    return null;
  }
});

export async function getHostInfo(): Promise<HostInfo> {
  const [distro, rebootReason, virtualization] = await Promise.all([
    readDistro(),
    readRebootReason(),
    readVirtualization()
  ]);

  return {
    hostname: os.hostname(),
    os: distro,
    kernel: os.release(),
    arch: os.arch(),
    bootTime: new Date(Date.now() - os.uptime() * 1000).toISOString(),
    rebootReason,
    virtualization
  };
}

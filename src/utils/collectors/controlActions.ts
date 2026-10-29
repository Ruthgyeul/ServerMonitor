import { logControlAction } from '@/utils/collectors/alerts';
import { getDockerDetails } from '@/utils/collectors/dockerDetails';
import { listJobs } from '@/utils/collectors/jobs';
import { isContainerName } from '@/utils/collectors/logs';
import { isServiceUnitName, listServiceUnits } from '@/utils/collectors/services';
import { runArgsBoth } from '@/utils/collectors/shell';

// The commands behind the control actions. Callers authorise first
// (authorizeControl); these validate names again, run without a shell, write
// the audit line and refresh the affected collector so the UI sees the result.

const ACTION_TIMEOUT_MS = 60_000;

export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause'] as const;
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number];
export const PRUNE_KINDS = ['images', 'volumes', 'buildCache'] as const;
export type PruneKind = (typeof PRUNE_KINDS)[number];
export const JOB_ACTIONS = ['run', 'enable', 'disable'] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

const IMAGE_ID = /^(sha256:)?[a-f0-9]{12,64}$/;

export function isImageId(id: string): boolean {
  return IMAGE_ID.test(id);
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// Pure: "Total reclaimed space: 1.31GB" from a prune's output.
export function reclaimedSpace(output: string): string | null {
  return output.match(/Total reclaimed space:\s*(\S+)/i)?.[1] ?? null;
}

// A short, safe description of why a command failed (stderr's first line,
// without paths or arguments echoed back).
export function failureReason(error: unknown): string {
  const stderr = (error as { stderr?: string } | null)?.stderr ?? '';
  if (/a password is required|sudo:/i.test(stderr))
    return 'not permitted (see the sudoers note in the README)';
  if (/permission denied|access denied|interactive authentication required/i.test(stderr))
    return 'permission denied';
  if (/no such (container|image)|not found|could not be found/i.test(stderr)) return 'not found';
  if ((error as { killed?: boolean } | null)?.killed) return 'timed out';
  return 'command failed';
}

async function run(file: string, args: string[], audit: string, done: string): Promise<ActionResult> {
  try {
    const { stdout } = await runArgsBoth(file, args, ACTION_TIMEOUT_MS);
    logControlAction(audit, true);
    return { ok: true, message: done.replace('{reclaimed}', reclaimedSpace(stdout) ?? '0B') };
  } catch (error) {
    const reason = failureReason(error);
    logControlAction(`${audit} failed: ${reason}`, false);
    return { ok: false, message: `${audit} failed: ${reason}` };
  }
}

// systemctl changes need root: run it directly as root, through `sudo -n`
// otherwise (fails fast, without prompting, when no sudoers rule allows it).
function systemctl(args: string[]): [string, string[]] {
  return typeof process.getuid === 'function' && process.getuid() === 0
    ? ['systemctl', args]
    : ['sudo', ['-n', 'systemctl', ...args]];
}

export async function containerAction(name: string, action: ContainerAction): Promise<ActionResult> {
  if (!isContainerName(name)) return { ok: false, message: 'Invalid container name' };
  const result = await run('docker', [action, name], `docker ${action} ${name}`, `${name}: ${action} done`);
  void getDockerDetails.refresh().catch(() => {});
  return result;
}

export async function removeImage(id: string): Promise<ActionResult> {
  if (!isImageId(id)) return { ok: false, message: 'Invalid image id' };
  const short = id.replace(/^sha256:/, '').slice(0, 12);
  const result = await run(
    'docker',
    ['image', 'rm', id],
    `docker image rm ${short}`,
    `Image ${short} removed`
  );
  void getDockerDetails.refresh().catch(() => {});
  return result;
}

const PRUNE_ARGS: Record<PruneKind, { args: string[]; label: string }> = {
  // Every image no container uses (what the page counts as reclaimable).
  images: { args: ['image', 'prune', '-a', '-f'], label: 'docker image prune -a' },
  // Unused anonymous volumes only; named volumes are left alone.
  volumes: { args: ['volume', 'prune', '-f'], label: 'docker volume prune' },
  buildCache: { args: ['builder', 'prune', '-f'], label: 'docker builder prune' }
};

export async function prune(kind: PruneKind): Promise<ActionResult> {
  const { args, label } = PRUNE_ARGS[kind];
  const result = await run('docker', args, label, 'Reclaimed {reclaimed}');
  void getDockerDetails.refresh().catch(() => {});
  return result;
}

export async function restartUnit(unit: string): Promise<ActionResult> {
  if (!isServiceUnitName(unit)) return { ok: false, message: 'Invalid unit name' };
  const [file, args] = systemctl(['restart', unit]);
  const result = await run(file, args, `systemctl restart ${unit}`, `${unit} restarted`);
  void listServiceUnits.refresh().catch(() => {});
  return result;
}

export async function jobAction(timer: string, action: JobAction): Promise<ActionResult> {
  const job = (await listJobs()).jobs.find(candidate => candidate.id === timer);
  if (!job) return { ok: false, message: 'Unknown job' };
  const [file, args] =
    action === 'run' ? systemctl(['start', '--no-block', job.service]) : systemctl([action, '--now', job.id]);
  const audit = action === 'run' ? `systemctl start ${job.service}` : `systemctl ${action} --now ${job.id}`;
  const done = action === 'run' ? `${job.name} started` : `${job.name} ${action}d`;
  const result = await run(file, args, audit, done);
  void listJobs.refresh().catch(() => {});
  return result;
}

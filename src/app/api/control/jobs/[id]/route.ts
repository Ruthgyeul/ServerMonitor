import { JOB_ACTIONS, jobAction, type JobAction } from '@/utils/collectors/controlActions';
import { isTimerName } from '@/utils/collectors/jobs';
import { authorizeControl } from '@/utils/control';
import { actionResponse, badRequest, pickField } from '@/utils/controlResponse';

// POST { action: run | enable | disable } on one scheduled job. The timer
// (e.g. restic-backup.timer) must be in CONTROL_ALLOWLIST_UNITS.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isTimerName(id)) return badRequest('Invalid job');
  const denied = authorizeControl(request, { kind: 'unit', name: id });
  if (denied) return denied;
  const action = await pickField<JobAction>(request, 'action', JOB_ACTIONS);
  if (!action) return badRequest('Unknown action');
  return actionResponse(await jobAction(id, action));
}

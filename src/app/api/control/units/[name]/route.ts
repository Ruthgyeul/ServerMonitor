import { restartUnit } from '@/utils/collectors/controlActions';
import { isServiceUnitName } from '@/utils/collectors/services';
import { authorizeControl } from '@/utils/control';
import { actionResponse, badRequest, pickField } from '@/utils/controlResponse';

// POST { action: restart } on one systemd service.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!isServiceUnitName(name)) return badRequest('Invalid unit name');
  const denied = authorizeControl(request, { kind: 'unit', name });
  if (denied) return denied;
  const action = await pickField(request, 'action', ['restart'] as const);
  if (!action) return badRequest('Unknown action');
  return actionResponse(await restartUnit(name));
}

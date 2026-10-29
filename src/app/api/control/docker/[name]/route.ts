import { CONTAINER_ACTIONS, containerAction, type ContainerAction } from '@/utils/collectors/controlActions';
import { isContainerName } from '@/utils/collectors/logs';
import { authorizeControl } from '@/utils/control';
import { actionResponse, badRequest, pickField } from '@/utils/controlResponse';

// POST { action: start | stop | restart | pause | unpause } on one container.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!isContainerName(name)) return badRequest('Invalid container name');
  const denied = authorizeControl(request, { kind: 'container', name });
  if (denied) return denied;

  const action = await pickField<ContainerAction>(request, 'action', CONTAINER_ACTIONS);
  if (!action) return badRequest('Unknown action');
  return actionResponse(await containerAction(name, action));
}

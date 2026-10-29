import { isImageId, removeImage } from '@/utils/collectors/controlActions';
import { authorizeControl } from '@/utils/control';
import { actionResponse, badRequest } from '@/utils/controlResponse';

// DELETE one image (not forced: Docker refuses one a container uses). Needs
// CONTROL_ALLOW_PRUNE.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isImageId(id)) return badRequest('Invalid image id');
  const denied = authorizeControl(request, { kind: 'prune' });
  if (denied) return denied;
  return actionResponse(await removeImage(id));
}

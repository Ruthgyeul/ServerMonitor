import { prune, PRUNE_KINDS, type PruneKind } from '@/utils/collectors/controlActions';
import { authorizeControl } from '@/utils/control';
import { actionResponse, badRequest, pickField } from '@/utils/controlResponse';

// POST { kind: images | volumes | buildCache }. Needs CONTROL_ALLOW_PRUNE.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = authorizeControl(request, { kind: 'prune' });
  if (denied) return denied;
  const kind = await pickField<PruneKind>(request, 'kind', PRUNE_KINDS);
  if (!kind) return badRequest('Unknown prune kind');
  return actionResponse(await prune(kind));
}

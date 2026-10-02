import { z } from 'zod';

import { getContainer } from '@/server/container';
import { route } from '@/server/http';
import { toDocumentDto } from '@/server/modules/documents/document.mapper';

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, async ({ params: { id }, user }) => {
  const document = await getContainer().documentService.get(user.id, id);
  return Response.json({ document: toDocumentDto(document) });
});

export const DELETE = route({ params }, async ({ params: { id }, user }) => {
  await getContainer().documentService.delete(user.id, id);
  return new Response(null, { status: 204 });
});

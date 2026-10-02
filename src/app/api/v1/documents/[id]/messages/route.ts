import { z } from 'zod';

import { getContainer } from '@/server/container';
import { route } from '@/server/http';
import { askResponse } from '@/server/modules/chat/ask-response';
import { toMessageDto } from '@/server/modules/chat/message.mapper';
import { askRequestSchema } from '@/shared/contracts/messages';

const params = z.object({ id: z.uuid() });

/** A question is a few hundred characters; anything near this limit is not a question. */
const ASK_BODY_LIMIT_BYTES = 16 * 1024;

export const GET = route({ params }, async ({ params: { id }, user }) => {
  const { documentService, chatService } = getContainer();
  await documentService.get(user.id, id); // 404 for documents that are missing or not yours
  const messages = await chatService.listMessages(user.id, id);
  return Response.json({ messages: messages.map(toMessageDto) });
});

/** The AI endpoint: SSE when the client sends `Accept: text/event-stream`, otherwise one JSON reply. */
export const POST = route(
  { params, body: askRequestSchema, maxBodyBytes: ASK_BODY_LIMIT_BYTES },
  ({ request, requestId, params: { id }, body, user }) => {
    const controller = new AbortController();
    const events = getContainer().chatService.ask({
      userId: user.id,
      documentId: id,
      question: body.question,
      requestId,
      instance: new URL(request.url).pathname,
      signal: controller.signal,
    });
    return askResponse({ request, requestId, events, controller });
  },
);

import { z } from 'zod';

import { getContainer } from '@/server/container';
import { route } from '@/server/http';
import { toMessageDto } from '@/server/modules/chat/message.mapper';
import { feedbackRequestSchema } from '@/shared/contracts/messages';

const params = z.object({ id: z.uuid() });

export const POST = route(
  { params, body: feedbackRequestSchema, maxBodyBytes: 4 * 1024 },
  async ({ params: { id }, body, user }) => {
    const message = await getContainer().chatService.rate(
      user.id,
      id,
      body.value,
      body.comment ?? null,
    );
    return Response.json({ message: toMessageDto(message) });
  },
);

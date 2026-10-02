import { z } from 'zod';

import { messageSchema } from './messages';
import { problemSchema } from './problem';

/** What the ask endpoint streams: acceptance, progress, text as it is written, then one outcome. */
export const askEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accepted'), userMessage: messageSchema }),
  z.object({ type: z.literal('status'), phase: z.enum(['retrieving', 'generating']) }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('final'), message: messageSchema }),
  z.object({ type: z.literal('error'), problem: problemSchema }),
]);

export type AskEvent = z.infer<typeof askEventSchema>;

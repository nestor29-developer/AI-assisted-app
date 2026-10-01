import { route } from '@/server/http';
import type { AuthResponse } from '@/shared/contracts/auth';

export const GET = route({}, ({ user }) => Response.json({ user } satisfies AuthResponse));

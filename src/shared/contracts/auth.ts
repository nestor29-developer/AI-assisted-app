import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(254, 'Use at most 254 characters.'));

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(128, 'Use at most 128 characters.'),
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(128, 'Use at most 128 characters.'),
});

export const sessionUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
});

export const authResponseSchema = z.object({ user: sessionUserSchema });

export type RegisterRequest = z.output<typeof registerRequestSchema>;
export type LoginRequest = z.output<typeof loginRequestSchema>;
export type SessionUserDto = z.infer<typeof sessionUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;

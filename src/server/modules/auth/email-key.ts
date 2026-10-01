import { createHmac } from 'node:crypto';

/** Purpose-bound subkey, so the JWT secret itself is never used directly as an HMAC key. */
export function createEmailKeyer(secret: string): (email: string) => string {
  const subkey = createHmac('sha256', secret).update('docqa:rate-limit:email').digest();
  return (email) => createHmac('sha256', subkey).update(email).digest('hex');
}

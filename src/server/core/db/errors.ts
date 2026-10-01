export const PG_UNIQUE_VIOLATION = '23505';

/** Drizzle wraps driver errors in `cause`, so look through a few levels for the SQLSTATE. */
export function hasPgErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && current.code === code) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

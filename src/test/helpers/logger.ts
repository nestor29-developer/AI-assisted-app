import pino from 'pino';

/** A real pino logger writing to memory, so tests can assert on what was (not) logged. */
export function createCapturingLogger(level = 'debug') {
  const lines: string[] = [];
  const logger = pino(
    { level, redact: ['password'] },
    { write: (line: string) => void lines.push(line) },
  );
  return {
    logger,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

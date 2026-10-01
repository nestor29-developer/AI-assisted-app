import pino, { type DestinationStream, type Logger } from 'pino';

import { getConfig } from '@/server/core/config/env';
import { SERVICE_NAME } from '@/server/core/constants';

export type { Logger };

const SENSITIVE_KEYS = ['password', 'token', 'apiKey', 'authorization', 'cookie', 'jwt', 'secret'];

const REDACT_PATHS = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export interface LoggerOptions {
  readonly level: string;
  readonly version: string;
  readonly destination?: DestinationStream;
}

/** Logs ids, counts and timings only; redaction is a safety net, never document or prompt text. */
export function createLogger({ level, version, destination }: LoggerOptions): Logger {
  return pino(
    {
      level,
      base: { service: SERVICE_NAME, version },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    destination,
  );
}

let cached: Logger | undefined;

export function getLogger(): Logger {
  if (!cached) {
    const config = getConfig();
    cached = createLogger({ level: config.logLevel, version: config.appVersion });
  }
  return cached;
}

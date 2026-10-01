import { describe, expect, it } from 'vitest';

import { createLogger } from './logger';

describe('createLogger', () => {
  it('emits JSON with service, version and a readable level', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      version: '1.2.3',
      destination: { write: (l) => void lines.push(l) },
    });

    logger.info({ documentId: 'doc-1' }, 'hello');

    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'info',
      service: 'ai-document-qa',
      version: '1.2.3',
      documentId: 'doc-1',
      msg: 'hello',
    });
  });

  it('redacts credentials even when they are logged by mistake', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      version: 't',
      destination: { write: (l) => void lines.push(l) },
    });

    logger.info(
      {
        password: 'hunter2',
        user: { token: 't0k3n' },
        req: { headers: { authorization: 'Bearer abc', cookie: 's=1' } },
      },
      'oops',
    );

    const output = lines[0]!;
    for (const secret of ['hunter2', 't0k3n', 'Bearer abc', 's=1'])
      expect(output).not.toContain(secret);
    expect(output).toContain('[REDACTED]');
  });
});

import { describe, expect, it } from 'vitest';

import { apiPaths } from './api-paths';

describe('apiPaths', () => {
  it('builds the plain paths', () => {
    expect(apiPaths.documents).toBe('/api/v1/documents');
    expect(apiPaths.document('abc')).toBe('/api/v1/documents/abc');
    expect(apiPaths.messages('abc')).toBe('/api/v1/documents/abc/messages');
    expect(apiPaths.feedback('abc')).toBe('/api/v1/messages/abc/feedback');
  });

  it('can never let an id change the shape of the path', () => {
    const hostile = '../x/messages?y=1#z';

    for (const path of [
      apiPaths.document(hostile),
      apiPaths.messages(hostile),
      apiPaths.feedback(hostile),
    ]) {
      expect(path).not.toMatch(/[?#]|\.\.\//);
      expect(path.split('/').filter(Boolean).length).toBeLessThanOrEqual(5);
    }
  });
});

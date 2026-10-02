import { describe, expect, it } from 'vitest';

import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '@/server/core/errors';

import { readMultipartUpload } from './upload';

function uploadRequest(form: FormData, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/documents', { method: 'POST', body: form, headers });
}

const file = (content: string, name = 'notes.txt') =>
  new File([content], name, { type: 'text/plain' });

describe('readMultipartUpload', () => {
  it('returns the file bytes, its name and the optional title', async () => {
    const form = new FormData();
    form.set('file', file('hello world', 'handbook.md'));
    form.set('title', 'Employee handbook');

    const upload = await readMultipartUpload(uploadRequest(form), 1_000);

    expect(upload.title).toBe('Employee handbook');
    expect(upload.file.name).toBe('handbook.md');
    expect(new TextDecoder().decode(upload.file.bytes)).toBe('hello world');
  });

  it('treats the title as optional', async () => {
    const form = new FormData();
    form.set('file', file('x'));

    expect((await readMultipartUpload(uploadRequest(form), 1_000)).title).toBeNull();
  });

  it('requires a multipart request', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ file: 'x' }),
      headers: { 'content-type': 'application/json' },
    });

    await expect(readMultipartUpload(request, 1_000)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeError,
    );
  });

  it('requires the file field to be an actual file', async () => {
    const missing = new FormData();
    missing.set('title', 'no file here');
    const text = new FormData();
    text.set('file', 'just a string');

    await expect(readMultipartUpload(uploadRequest(missing), 1_000)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(readMultipartUpload(uploadRequest(text), 1_000)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects an oversized file whether or not the length was declared', async () => {
    const form = new FormData();
    form.set('file', file('x'.repeat(5_000)));

    await expect(readMultipartUpload(uploadRequest(form), 1_000)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it('stops reading a body that is far larger than allowed (no unbounded buffering)', async () => {
    const form = new FormData();
    form.set('file', file('x'.repeat(500_000)));

    await expect(readMultipartUpload(uploadRequest(form), 1_000)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it('reports a malformed multipart body as a validation error, not a 500', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      body: 'this is not multipart at all',
      headers: { 'content-type': 'multipart/form-data; boundary=nope' },
    });

    await expect(readMultipartUpload(request, 1_000)).rejects.toBeInstanceOf(ValidationError);
  });

  it('caps absurdly long file names', async () => {
    const form = new FormData();
    form.set('file', file('x', `${'a'.repeat(400)}.txt`));

    expect((await readMultipartUpload(uploadRequest(form), 1_000)).file.name.length).toBe(255);
  });
});

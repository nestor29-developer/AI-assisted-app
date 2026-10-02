import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '@/server/core/errors';

import { readBodyCapped } from './input';

/** Room for multipart boundaries and the other form fields around the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_FILENAME_CHARS = 255;

export interface Upload {
  readonly title: string | null;
  readonly file: { readonly name: string; readonly bytes: Uint8Array };
}

/** Reads a multipart upload under a hard size cap, even when the client omits Content-Length. */
export async function readMultipartUpload(request: Request, maxFileBytes: number): Promise<Upload> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new UnsupportedMediaTypeError('Send the file as multipart/form-data.');
  }

  const body = await readBodyCapped(request, maxFileBytes + MULTIPART_OVERHEAD_BYTES);
  let form: FormData;
  try {
    // Re-wrapping the capped bytes lets the platform parser do the multipart work safely.
    form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new ValidationError([{ path: 'file', message: 'The upload could not be read.' }]);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new ValidationError([{ path: 'file', message: 'Choose a file to upload.' }]);
  }
  if (file.size > maxFileBytes) throw new PayloadTooLargeError(maxFileBytes);

  const title = form.get('title');
  return {
    title: typeof title === 'string' ? title : null,
    file: {
      name: file.name.slice(0, MAX_FILENAME_CHARS),
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
  };
}

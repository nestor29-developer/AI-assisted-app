import { UnprocessableError } from '@/server/core/errors';

import type { ExtractedContent, TextExtractor } from './types';

export class PlainTextExtractor implements TextExtractor {
  async extract(bytes: Uint8Array): Promise<ExtractedContent> {
    let text: string;
    try {
      // Strict decoding: guessing at a legacy encoding would silently corrupt the text.
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new UnprocessableError('DOCUMENT_REJECTED', 'The file is not valid UTF-8 text.');
    }
    if (text.includes('\u0000')) {
      throw new UnprocessableError(
        'DOCUMENT_REJECTED',
        'The file looks like binary data, not text.',
      );
    }
    return { pages: null, text, pageCount: null };
  }
}

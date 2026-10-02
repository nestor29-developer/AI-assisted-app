import { hasHiddenText, sanitizeText } from '@/server/ai/guardrails/sanitize';
import { detectInjection } from '@/server/ai/guardrails/injection-detector';
import { estimateEmbeddingCostUsd } from '@/server/ai/pricing';
import { AiProviderError } from '@/server/ai/providers/errors';
import type { EmbeddingProvider } from '@/server/ai/providers/types';
import { CHUNKER_VERSION, chunkPages, chunkText, type Chunk } from '@/server/ai/rag/chunker';
import { estimateTokens } from '@/server/ai/tokens';
import { mapConcurrent } from '@/server/core/concurrency';
import {
  AiUnavailableError,
  NotFoundError,
  UnprocessableError,
  toLoggableError,
} from '@/server/core/errors';
import type { Logger } from '@/server/core/logger';
import { truncate } from '@/server/core/text';
import type { AiRequestRepository } from '@/server/modules/usage/ai-request.repository';
import { enforceRateLimit, type RateLimiter } from '@/server/modules/usage/rate-limiter';
import { DOCUMENT_TITLE_MAX } from '@/shared/contracts/documents';

import type {
  DocumentRecord,
  DocumentRepository,
  DocumentSummaryRecord,
} from './document.repository';
import {
  detectFileKind,
  extractorFor,
  mimeTypeFor,
  type ExtractedContent,
  type UploadedFile,
} from './extractors';

const EMBED_BATCH_SIZE = 16;
const EMBED_CONCURRENCY = 3;
const PDF_PARSE_TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;
const UPLOADS_WINDOW_SECONDS = 3_600;

export interface DocumentServiceConfig {
  readonly maxPdfPages: number;
  readonly maxDocumentChars: number;
  readonly uploadsPerHour: number;
  readonly documentRetentionDays: number;
  readonly appVersion: string;
}

export interface DocumentServiceDeps {
  readonly documents: DocumentRepository;
  readonly embeddings: EmbeddingProvider;
  readonly aiRequests: AiRequestRepository;
  readonly rateLimiter: RateLimiter;
  readonly logger: Logger;
  readonly config: DocumentServiceConfig;
  readonly now?: () => Date;
}

interface IngestInput {
  readonly userId: string;
  readonly title: string;
  readonly sourceType: 'text' | 'file';
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly extracted: ExtractedContent;
}

function deriveTitle(provided: string | null, fileName: string): string {
  const candidate = provided?.trim() || fileName.replace(/\.[^.]+$/, '');
  return truncate(sanitizeText(candidate).text.trim(), DOCUMENT_TITLE_MAX).trimEnd() || 'Untitled';
}

function batchesOf<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    batches.push(items.slice(start, start + size));
  return batches;
}

export class DocumentService {
  constructor(private readonly deps: DocumentServiceDeps) {}

  async createFromText(
    userId: string,
    input: { title: string; text: string },
  ): Promise<DocumentRecord> {
    await this.throttleUploads(userId);
    return this.ingest({
      userId,
      title: deriveTitle(input.title, ''),
      sourceType: 'text',
      mimeType: 'text/plain',
      sizeBytes: new TextEncoder().encode(input.text).length,
      extracted: { pages: null, text: input.text, pageCount: null },
    });
  }

  async createFromFile(
    userId: string,
    input: { title: string | null; file: UploadedFile },
  ): Promise<DocumentRecord> {
    await this.throttleUploads(userId);
    const kind = detectFileKind(input.file);
    const extracted = await extractorFor(kind).extract(input.file.bytes, {
      maxPdfPages: this.deps.config.maxPdfPages,
      parseTimeoutMs: PDF_PARSE_TIMEOUT_MS,
    });
    return this.ingest({
      userId,
      title: deriveTitle(input.title, input.file.name),
      sourceType: 'file',
      mimeType: mimeTypeFor(kind),
      sizeBytes: input.file.bytes.length,
      extracted,
    });
  }

  list(userId: string): Promise<DocumentSummaryRecord[]> {
    return this.deps.documents.listByUser(userId);
  }

  async get(userId: string, id: string): Promise<DocumentSummaryRecord> {
    const document = await this.deps.documents.findById(userId, id);
    if (!document) throw new NotFoundError('Document');
    return document;
  }

  async delete(userId: string, id: string): Promise<void> {
    if (!(await this.deps.documents.delete(userId, id))) throw new NotFoundError('Document');
  }

  private throttleUploads(userId: string): Promise<void> {
    return enforceRateLimit(this.deps.rateLimiter, {
      key: `upload:user:${userId}`,
      limit: this.deps.config.uploadsPerHour,
      windowSeconds: UPLOADS_WINDOW_SECONDS,
    });
  }

  private async ingest(input: IngestInput): Promise<DocumentRecord> {
    const { documents, embeddings, logger, config } = this.deps;
    const cleaned = input.extracted.pages
      ? input.extracted.pages.map((page) => sanitizeText(page))
      : [sanitizeText(input.extracted.text)];
    const pageTexts = cleaned.map((result) => result.text);
    const text = input.extracted.pages ? pageTexts.join('\f') : pageTexts[0]!;
    const hiddenUnicode = cleaned.some(hasHiddenText);

    if (text.length > config.maxDocumentChars) {
      throw new UnprocessableError(
        'DOCUMENT_REJECTED',
        `The document has ${text.length.toLocaleString('en-US')} characters; the limit is ${config.maxDocumentChars.toLocaleString('en-US')}.`,
      );
    }
    const chunks: Chunk[] = input.extracted.pages ? chunkPages(pageTexts) : chunkText(text);
    if (chunks.length === 0) {
      throw new UnprocessableError('DOCUMENT_REJECTED', 'The document has no readable text.');
    }

    const verdict = detectInjection(text, { hiddenUnicodeFound: hiddenUnicode });
    if (verdict.level !== 'none') {
      logger.warn(
        { userId: input.userId, risk: verdict.level, signals: verdict.signals },
        'uploaded document contains instruction-like text',
      );
    }

    const startedAt = performance.now();
    const { vectors, inputTokens } = await this.embedChunks(input.title, chunks);
    const latencyMs = Math.round(performance.now() - startedAt);

    const now = (this.deps.now ?? (() => new Date()))();
    const record = await documents.createWithChunks(
      {
        userId: input.userId,
        title: input.title,
        sourceType: input.sourceType,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        pageCount: input.extracted.pageCount,
        content: text,
        tokenEstimate: estimateTokens(text),
        embeddingModel: embeddings.model,
        chunkerVersion: CHUNKER_VERSION,
        expiresAt: new Date(now.getTime() + config.documentRetentionDays * DAY_MS),
      },
      chunks.map((chunk, ordinal) => ({
        ordinal,
        page: chunk.page,
        content: chunk.text,
        embedding: vectors[ordinal]!,
      })),
    );

    await this.recordUsage(record, inputTokens, latencyMs, verdict.level === 'high');
    return record;
  }

  private async embedChunks(title: string, chunks: readonly Chunk[]) {
    const { embeddings } = this.deps;
    try {
      const results = await mapConcurrent(
        batchesOf(chunks, EMBED_BATCH_SIZE),
        EMBED_CONCURRENCY,
        async (batch) => {
          const result = await embeddings.embed(
            batch.map((chunk) => chunk.text),
            'document',
            { title },
          );
          if (result.vectors.length !== batch.length) {
            throw new AiProviderError(
              'The embedding provider returned the wrong number of vectors',
              {
                retryable: false,
              },
            );
          }
          return result;
        },
      );
      return {
        vectors: results.flatMap((result) => result.vectors),
        inputTokens: results.reduce((sum, result) => sum + result.inputTokens, 0),
      };
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw new AiUnavailableError(
          error,
          error.retryAfterMs && Math.ceil(error.retryAfterMs / 1000),
        );
      }
      throw error;
    }
  }

  /** Audit and cost trail; the document is already stored, so a failure here must not fail the upload. */
  private async recordUsage(
    record: DocumentRecord,
    inputTokens: number,
    latencyMs: number,
    injectionFlag: boolean,
  ): Promise<void> {
    const { aiRequests, embeddings, logger, config } = this.deps;
    try {
      await aiRequests.recordEmbedding({
        userId: record.userId,
        documentId: record.id,
        provider: embeddings.name,
        model: embeddings.model,
        appVersion: config.appVersion,
        inputTokens,
        costUsd: estimateEmbeddingCostUsd(embeddings.model, inputTokens),
        latencyMs,
        injectionFlag,
      });
    } catch (error) {
      logger.error(
        { err: toLoggableError(error), documentId: record.id },
        'could not record embedding usage',
      );
    }
  }
}

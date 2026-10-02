import type { DocumentSummary } from '@/shared/contracts/documents';

import type { DocumentSummaryRecord } from './document.repository';

export function toDocumentDto(record: DocumentSummaryRecord): DocumentSummary {
  return {
    id: record.id,
    title: record.title,
    sourceType: record.sourceType,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    pageCount: record.pageCount,
    chunkCount: record.chunkCount,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}

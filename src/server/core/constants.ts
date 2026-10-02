/** Fixed by the `vector(768)` column; changing it needs a migration and a re-embed. */
export const EMBEDDING_DIMENSIONS = 768;

export const SERVICE_NAME = 'ai-document-qa';

/** Retrieval defaults shared by the app and the eval, so the eval measures what production does. */
export const DEFAULT_FULL_CONTEXT_MAX_TOKENS = 3_000;
export const DEFAULT_RAG_TOP_K = 6;

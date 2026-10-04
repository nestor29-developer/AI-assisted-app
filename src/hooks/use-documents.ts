'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch, apiSend } from '@/lib/api-client';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import {
  documentListResponseSchema,
  documentResponseSchema,
  type CreateTextDocument,
  type DocumentSummary,
} from '@/shared/contracts/documents';
import {
  messageListResponseSchema,
  messageResponseSchema,
  type MessageDto,
} from '@/shared/contracts/messages';

export function useDocuments() {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: async ({ signal }) =>
      (await apiFetch(apiPaths.documents, documentListResponseSchema, { signal })).documents,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: queryKeys.document(id),
    queryFn: async ({ signal }) =>
      (await apiFetch(apiPaths.document(id), documentResponseSchema, { signal })).document,
  });
}

export function useMessages(documentId: string) {
  return useQuery({
    queryKey: queryKeys.messages(documentId),
    queryFn: async ({ signal }) =>
      (await apiFetch(apiPaths.messages(documentId), messageListResponseSchema, { signal }))
        .messages,
  });
}

/** Adding a document, however it arrives, refreshes the list and seeds the detail cache. */
function useAddedDocument<Variables>(request: (variables: Variables) => Promise<DocumentSummary>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async (document) => {
      queryClient.setQueryData(queryKeys.document(document.id), document);
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents, exact: true });
    },
  });
}

export function useCreateTextDocument() {
  return useAddedDocument(
    async (input: CreateTextDocument) =>
      (await apiFetch(apiPaths.documents, documentResponseSchema, { method: 'POST', json: input }))
        .document,
  );
}

export interface UploadInput {
  readonly file: File;
  readonly title: string;
}

export function useUploadDocument() {
  return useAddedDocument(async ({ file, title }: UploadInput) => {
    const form = new FormData();
    form.set('file', file);
    if (title.trim()) form.set('title', title.trim());
    return (await apiFetch(apiPaths.documents, documentResponseSchema, { method: 'POST', form }))
      .document;
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend(apiPaths.document(id), { method: 'DELETE' }),
    onSuccess: async (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.document(id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents, exact: true });
    },
  });
}

export function useRateMessage(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, value }: { messageId: string; value: 'up' | 'down' }) =>
      (
        await apiFetch(apiPaths.feedback(messageId), messageResponseSchema, {
          method: 'POST',
          json: { value },
        })
      ).message,
    onSuccess: (message) => {
      queryClient.setQueryData<MessageDto[]>(queryKeys.messages(documentId), (messages) =>
        messages?.map((existing) => (existing.id === message.id ? message : existing)),
      );
    },
  });
}

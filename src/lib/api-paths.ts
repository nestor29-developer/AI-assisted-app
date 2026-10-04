/** Every path with an id goes through here, so an id can never change the shape of the URL. */
const segment = encodeURIComponent;

export const apiPaths = {
  documents: '/api/v1/documents',
  document: (documentId: string) => `/api/v1/documents/${segment(documentId)}`,
  messages: (documentId: string) => `/api/v1/documents/${segment(documentId)}/messages`,
  feedback: (messageId: string) => `/api/v1/messages/${segment(messageId)}/feedback`,
} as const;

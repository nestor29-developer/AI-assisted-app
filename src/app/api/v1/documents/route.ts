import { getContainer } from '@/server/container';
import { readJsonBody } from '@/server/core/http/input';
import { readMultipartUpload } from '@/server/core/http/upload';
import { route } from '@/server/http';
import { toDocumentDto } from '@/server/modules/documents/document.mapper';
import { createTextDocumentSchema, type DocumentSummary } from '@/shared/contracts/documents';

export const GET = route({}, async ({ user }) => {
  const { documentService } = getContainer();
  const documents = await documentService.list(user.id);
  return Response.json({ documents: documents.map(toDocumentDto) });
});

/** Accepts pasted text as JSON, or a .txt / .md / .pdf file as multipart/form-data. */
export const POST = route({}, async ({ request, user }) => {
  const { documentService, config } = getContainer();
  const isUpload = (request.headers.get('content-type') ?? '')
    .toLowerCase()
    .startsWith('multipart/form-data');

  const document = isUpload
    ? await documentService.createFromFile(
        user.id,
        await readMultipartUpload(request, config.limits.maxUploadBytes),
      )
    : await documentService.createFromText(
        user.id,
        await readJsonBody(request, createTextDocumentSchema, config.limits.maxUploadBytes),
      );

  return Response.json(
    { document: toDocumentDto(document) satisfies DocumentSummary },
    { status: 201 },
  );
});

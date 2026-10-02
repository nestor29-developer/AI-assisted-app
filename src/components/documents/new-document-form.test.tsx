import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { json, problem, stubApi } from '@/test/helpers/api';
import { renderWithClient } from '@/test/helpers/render';
import { makeDocument } from '@/test/fixtures/messages';

import { NewDocumentForm } from './new-document-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const created = makeDocument({ title: 'Notes' });

beforeEach(() => push.mockClear());

describe('NewDocumentForm: pasted text', () => {
  it('asks for a title and some text before sending anything', async () => {
    const user = userEvent.setup();
    const api = stubApi({});

    renderWithClient(<NewDocumentForm />);
    await user.click(screen.getByRole('button', { name: 'Add document' }));

    expect(screen.getByText('Give the document a title.')).toBeInTheDocument();
    expect(screen.getByText('Paste some text first.')).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it('sends the title and text, then opens the new document', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'POST /api/v1/documents': () => json({ document: created }, 201),
      'GET /api/v1/documents': () => json({ documents: [created] }),
    });

    renderWithClient(<NewDocumentForm />);
    await user.type(screen.getByLabelText('Title'), '  Notes  ');
    await user.type(screen.getByLabelText('Text'), 'Employees accrue 1.5 days per month.');
    await user.click(screen.getByRole('button', { name: 'Add document' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/documents/${created.id}`));
    expect(api.callsTo('POST /api/v1/documents')[0]?.body).toEqual({
      title: 'Notes',
      text: 'Employees accrue 1.5 days per month.',
    });
  });

  it('shows the reason when the server turns the text down, and keeps what was typed', async () => {
    const user = userEvent.setup();
    stubApi({
      'POST /api/v1/documents': () =>
        problem(422, 'DOCUMENT_REJECTED', { detail: 'The document has no readable text.' }),
    });

    renderWithClient(<NewDocumentForm />);
    await user.type(screen.getByLabelText('Title'), 'Notes');
    await user.type(screen.getByLabelText('Text'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Add document' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The document has no readable text.',
    );
    expect(screen.getByLabelText('Text')).toHaveValue('hello');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('NewDocumentForm: file upload', () => {
  async function openUploadTab() {
    const user = userEvent.setup({ applyAccept: false });
    renderWithClient(<NewDocumentForm />);
    await user.click(screen.getByRole('tab', { name: 'Upload a file' }));
    return user;
  }

  it('switches tabs by click and with the arrow keys', async () => {
    const user = userEvent.setup();
    renderWithClient(<NewDocumentForm />);

    expect(screen.getByRole('tab', { name: 'Paste text' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    screen.getByRole('tab', { name: 'Paste text' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Upload a file' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('File')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
  });

  it('tells the person the limits up front', async () => {
    await openUploadTab();

    expect(screen.getByText(/\.txt, \.md or \.pdf, up to 10 MB/)).toBeInTheDocument();
    expect(screen.getByText(/scans are not supported/)).toBeInTheDocument();
  });

  it('asks for a file before sending anything', async () => {
    const user = await openUploadTab();
    const api = stubApi({});

    await user.click(screen.getByRole('button', { name: 'Upload and add' }));

    expect(screen.getByText('Choose a file to upload.')).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it.each([
    ['an unsupported type', new File(['x'], 'notes.docx'), 'Choose a .txt, .md, .pdf file.'],
    ['an empty file', new File([], 'notes.txt'), 'That file is empty.'],
  ])('refuses %s without calling the server', async (_label, file, message) => {
    const user = await openUploadTab();
    const api = stubApi({});

    await user.upload(screen.getByLabelText('File'), file);
    await user.click(screen.getByRole('button', { name: 'Upload and add' }));

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(api.calls).toHaveLength(0);
  });

  it('refuses a file over the size limit', async () => {
    const user = await openUploadTab();
    const api = stubApi({});
    const big = new File(['x'], 'big.txt');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });

    await user.upload(screen.getByLabelText('File'), big);
    await user.click(screen.getByRole('button', { name: 'Upload and add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('larger than 10 MB');
    expect(api.calls).toHaveLength(0);
  });

  it('uploads the file as multipart with the optional title, then opens the document', async () => {
    const user = await openUploadTab();
    const api = stubApi({
      'POST /api/v1/documents': () => json({ document: created }, 201),
      'GET /api/v1/documents': () => json({ documents: [created] }),
    });
    const file = new File(['Hello policy'], 'policy.md', { type: 'text/markdown' });

    await user.upload(screen.getByLabelText('File'), file);
    expect(screen.getByText('Size: 12 B')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Title (optional)'), 'Policy');
    await user.click(screen.getByRole('button', { name: 'Upload and add' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/documents/${created.id}`));
    const body = api.callsTo('POST /api/v1/documents')[0]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('title')).toBe('Policy');
    expect(((body as FormData).get('file') as File).name).toBe('policy.md');
    expect(api.callsTo('POST /api/v1/documents')[0]?.headers.has('content-type')).toBe(false);
  });

  it('shows the server explanation for a scanned PDF', async () => {
    const user = await openUploadTab();
    stubApi({
      'POST /api/v1/documents': () =>
        problem(422, 'PDF_NO_TEXT_LAYER', { detail: 'This PDF has no selectable text.' }),
    });

    await user.upload(screen.getByLabelText('File'), new File(['%PDF-'], 'scan.pdf'));
    await user.click(screen.getByRole('button', { name: 'Upload and add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This PDF has no selectable text.');
    expect(push).not.toHaveBeenCalled();
  });
});

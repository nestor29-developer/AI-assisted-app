'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { panelId, tabId, Tabs, type TabItem } from '@/components/ui/tabs';
import { TextArea } from '@/components/ui/text-area';
import { TextField } from '@/components/ui/text-field';
import { useCreateTextDocument, useUploadDocument } from '@/hooks/use-documents';
import { describeError } from '@/lib/api-errors';
import { formatBytes } from '@/lib/format';
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  createTextDocumentSchema,
  DEFAULT_MAX_PDF_PAGES,
  DEFAULT_MAX_UPLOAD_MB,
} from '@/shared/contracts/documents';

type Mode = 'paste' | 'upload';
const TABS: readonly TabItem<Mode>[] = [
  { id: 'paste', label: 'Paste text' },
  { id: 'upload', label: 'Upload a file' },
];
const PREFIX = 'new-document';
const MAX_UPLOAD_BYTES = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;

type FieldErrors = Partial<Record<'title' | 'text' | 'file', string>>;

function PasteForm({ onCreated }: { readonly onCreated: (id: string) => void }) {
  const create = useCreateTextDocument();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createTextDocumentSchema.safeParse({ title, text });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === 'title' || field === 'text') && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, { onSuccess: (document) => onCreated(document.id) });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {create.isError ? <Alert tone="error">{describeError(create.error)}</Alert> : null}
      <TextField
        label="Title"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={errors.title}
        maxLength={200}
        required
      />
      <TextArea
        label="Text"
        name="text"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        error={errors.text}
        hint="Paste the text you want to ask questions about."
        required
      />
      <Button type="submit" loading={create.isPending}>
        Add document
      </Button>
    </form>
  );
}

function checkFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_UPLOAD_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return `Choose a ${ACCEPTED_UPLOAD_EXTENSIONS.join(', ')} file.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) return `That file is larger than ${DEFAULT_MAX_UPLOAD_MB} MB.`;
  if (file.size === 0) return 'That file is empty.';
  return null;
}

function UploadForm({ onCreated }: { readonly onCreated: (id: string) => void }) {
  const upload = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setErrors({ file: 'Choose a file to upload.' });
      return;
    }
    const problem = checkFile(file);
    if (problem) {
      setErrors({ file: problem });
      return;
    }
    setErrors({});
    upload.mutate({ file, title }, { onSuccess: (document) => onCreated(document.id) });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {upload.isError ? <Alert tone="error">{describeError(upload.error)}</Alert> : null}
      <div className="space-y-1.5">
        <label htmlFor="upload-file" className="block text-sm font-medium text-slate-700">
          File
        </label>
        <input
          id="upload-file"
          type="file"
          name="file"
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setErrors({});
          }}
          aria-invalid={errors.file ? true : undefined}
          aria-describedby="upload-file-hint"
          className="block w-full text-sm text-slate-700 file:mr-3 file:h-10 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-4 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
        />
        <p id="upload-file-hint" className="text-xs text-slate-500">
          .txt, .md or .pdf, up to {DEFAULT_MAX_UPLOAD_MB} MB. PDFs need selectable text (scans are
          not supported) and up to {DEFAULT_MAX_PDF_PAGES} pages.
        </p>
        {file && !errors.file ? (
          <p className="text-xs text-slate-600">Size: {formatBytes(file.size)}</p>
        ) : null}
        {errors.file ? (
          <p role="alert" className="text-xs text-red-600">
            {errors.file}
          </p>
        ) : null}
      </div>
      <TextField
        label="Title (optional)"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        hint="Defaults to the file name."
        maxLength={200}
      />
      <Button type="submit" loading={upload.isPending}>
        Upload and add
      </Button>
    </form>
  );
}

export function NewDocumentForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('paste');
  const open = (id: string) => router.push(`/documents/${id}`);

  return (
    <section
      aria-labelledby="new-document-heading"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="space-y-1">
        <h2 id="new-document-heading" className="text-base font-semibold text-slate-900">
          Add a document
        </h2>
        <p className="text-sm text-slate-600">
          Add some text, then ask questions and get answers with quotes you can check.
        </p>
      </div>
      <Tabs
        label="How to add a document"
        idPrefix={PREFIX}
        tabs={TABS}
        value={mode}
        onValueChange={setMode}
      />
      <div role="tabpanel" id={panelId(PREFIX, mode)} aria-labelledby={tabId(PREFIX, mode)}>
        {mode === 'paste' ? <PasteForm onCreated={open} /> : <UploadForm onCreated={open} />}
      </div>
    </section>
  );
}

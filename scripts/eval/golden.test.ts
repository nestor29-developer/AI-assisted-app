import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { estimateTokens } from '@/server/ai/tokens';

import { loadGolden } from './golden';

const GOLDEN = resolve('evals/golden.json');
const squash = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

describe('the golden set', () => {
  it('loads and covers every kind of question on both context paths', async () => {
    const { golden } = await loadGolden(GOLDEN);

    const kinds = new Set(golden.cases.map((testCase) => testCase.kind));
    const documents = new Set(golden.cases.map((testCase) => testCase.document));
    expect(kinds).toEqual(new Set(['answerable', 'unanswerable', 'injection']));
    expect(documents).toEqual(new Set(['handbook', 'leave']));
    expect(golden.cases.length).toBeGreaterThanOrEqual(15);
  });

  it('keeps every evidence phrase in its document, so an edit to a fixture cannot silently break a case', async () => {
    const { golden, documents } = await loadGolden(GOLDEN);

    for (const testCase of golden.cases) {
      if (testCase.kind === 'unanswerable' || testCase.evidence === undefined) continue;
      const text = squash(documents.get(testCase.document) ?? '');
      expect(text, `${testCase.id}: evidence is missing from ${testCase.document}`).toContain(
        squash(testCase.evidence),
      );
    }
  });

  it('really plants the injected note that the document-injection case watches for', async () => {
    const { documents } = await loadGolden(GOLDEN);

    expect(documents.get('handbook')).toContain('PWNED');
    expect(documents.get('handbook')).toMatch(/ignore all previous instructions/i);
  });

  it('keeps the handbook big enough to force retrieval and the policy small enough for full context', async () => {
    const { documents } = await loadGolden(GOLDEN);

    expect(estimateTokens(documents.get('handbook') ?? '')).toBeGreaterThan(3_000);
    expect(estimateTokens(documents.get('leave') ?? '')).toBeLessThan(3_000);
  });

  it('asks for unanswerable things the documents really do not contain', async () => {
    const { documents } = await loadGolden(GOLDEN);
    const everything = squash([...documents.values()].join(' '));

    for (const absent of ['parental leave', 'stock option', 'paternity', ' dog ']) {
      expect(everything).not.toContain(absent);
    }
  });
});

describe('loadGolden validation', () => {
  async function load(contents: unknown) {
    const folder = await mkdtemp(join(tmpdir(), 'golden-'));
    await writeFile(join(folder, 'doc.md'), 'Some document text.');
    await writeFile(join(folder, 'golden.json'), JSON.stringify(contents));
    return loadGolden(join(folder, 'golden.json'));
  }
  const thresholds = {
    schemaValid: 1,
    citationsVerified: 1,
    keywordRecall: 1,
    retrievalHit: 1,
    notFoundAccuracy: 1,
    injectionResistance: 1,
  };
  const base = {
    documents: { doc: 'doc.md' },
    thresholds: { mock: thresholds, gemini: thresholds },
  };
  const unanswerable = { id: 'a', document: 'doc', kind: 'unanswerable', question: 'Q?' };

  it('accepts a minimal valid file', async () => {
    const { golden, documents } = await load({ ...base, cases: [unanswerable] });

    expect(golden.cases).toHaveLength(1);
    expect(documents.get('doc')).toBe('Some document text.');
  });

  it.each([
    ['a duplicate id', [unanswerable, unanswerable], /duplicate id a/],
    ['an unknown document', [{ ...unanswerable, document: 'nope' }], /unknown document nope/],
    [
      'an answerable case with no expectations',
      [{ ...unanswerable, kind: 'answerable' }],
      /mustContain|evidence/,
    ],
    [
      'an injection case with nothing to watch for',
      [{ ...unanswerable, kind: 'injection' }],
      /forbidden/,
    ],
    ['no cases', [], /too small|at least/i],
  ])('rejects %s', async (_label, cases, message) => {
    await expect(load({ ...base, cases })).rejects.toThrow(message);
  });

  it('rejects a threshold outside 0 to 1', async () => {
    const broken = { ...thresholds, schemaValid: 1.5 };

    await expect(
      load({ ...base, thresholds: { mock: broken, gemini: thresholds }, cases: [unanswerable] }),
    ).rejects.toThrow();
  });
});

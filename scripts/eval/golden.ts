import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

export const METRICS = [
  'schemaValid',
  'citationsVerified',
  'citationsRelevant',
  'keywordRecall',
  'retrievalHit',
  'retrievalMrr',
  'notFoundAccuracy',
  'injectionResistance',
] as const;
export type MetricName = (typeof METRICS)[number];

const ratio = z.number().min(0).max(1);
const thresholdsSchema = z.object({
  schemaValid: ratio,
  citationsVerified: ratio,
  citationsRelevant: ratio,
  keywordRecall: ratio,
  retrievalHit: ratio,
  retrievalMrr: ratio,
  notFoundAccuracy: ratio,
  injectionResistance: ratio,
});
export type Thresholds = z.infer<typeof thresholdsSchema>;

/** Any one of the alternatives satisfies the group, so "3" and "three" can both be right. */
const alternatives = z.array(z.string().min(1)).min(1);
const phrases = z.array(z.string().min(1)).min(1);
const base = {
  id: z.string().min(1),
  document: z.string().min(1),
  question: z.string().min(1),
  /** Earlier questions asked first in the same conversation, so follow-ups and history are exercised. */
  turns: z.array(z.string().min(1)).optional(),
};

const caseSchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('answerable'),
    mustContain: z.array(alternatives).min(1),
    /** Wrong answers that sit next to the right one (a negation, a neighbouring figure). */
    mustNotContain: phrases.optional(),
    /** A phrase the retrieved sources must contain, or the model never saw the answer. */
    evidence: z.string().min(1),
  }),
  z.object({
    ...base,
    kind: z.literal('unanswerable'),
    /** Text that would show an invention, for example a number or a policy name. */
    forbidden: phrases.optional(),
  }),
  z.object({
    ...base,
    kind: z.literal('injection'),
    /** Text that would show the attack worked, for example the word the injected note demands. */
    forbidden: phrases,
    mustContain: z.array(alternatives).optional(),
    mustNotContain: phrases.optional(),
    evidence: z.string().min(1).optional(),
  }),
]);
export type EvalCase = z.infer<typeof caseSchema>;

const goldenSchema = z
  .object({
    documents: z.record(z.string(), z.string()),
    /** Text a planted instruction asks for. Seeing it in any reply to any question means an attack worked. */
    canaries: z.array(z.string().min(1)).default([]),
    thresholds: z.object({ mock: thresholdsSchema, gemini: thresholdsSchema }),
    cases: z.array(caseSchema).min(1),
  })
  .superRefine((golden, ctx) => {
    const seen = new Set<string>();
    golden.cases.forEach((testCase, index) => {
      if (seen.has(testCase.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cases', index, 'id'],
          message: `duplicate id ${testCase.id}`,
        });
      }
      seen.add(testCase.id);
      if (!(testCase.document in golden.documents)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cases', index, 'document'],
          message: `unknown document ${testCase.document}`,
        });
      }
    });
  });
export type Golden = z.infer<typeof goldenSchema>;

export interface LoadedGolden {
  readonly golden: Golden;
  /** Document key to its text. */
  readonly documents: ReadonlyMap<string, string>;
}

export async function loadGolden(path: string): Promise<LoadedGolden> {
  const golden = goldenSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const folder = dirname(path);
  const entries = await Promise.all(
    Object.entries(golden.documents).map(
      async ([key, file]) => [key, await readFile(resolve(folder, file), 'utf8')] as const,
    ),
  );
  return { golden, documents: new Map(entries) };
}

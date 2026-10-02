import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { ConfigResult } from './report';

const baselineSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  passing: z.array(z.string().min(1)),
  failing: z.array(z.string().min(1)),
});
export type Baseline = z.infer<typeof baselineSchema>;

export interface BaselineCheck {
  /** Passed in the baseline and fails now. These fail the run. */
  readonly regressions: readonly string[];
  /** Failed in the baseline and passes now: the baseline can be raised. */
  readonly improvements: readonly string[];
  /** Cases the baseline has never seen. */
  readonly unlisted: readonly string[];
}

export function toBaseline(result: ConfigResult): Baseline {
  const failing = new Set(result.cases.failing);
  const ids = [...new Set(result.runs.map((run) => run.caseId))];
  return {
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    passing: ids.filter((id) => !failing.has(id)).sort(),
    failing: [...failing].sort(),
  };
}

/** A baseline describes one configuration; comparing another one against it would mean nothing. */
export const baselineApplies = (baseline: Baseline, result: ConfigResult): boolean =>
  baseline.provider === result.provider &&
  baseline.model === result.model &&
  baseline.promptVersion === result.promptVersion;

export function compareToBaseline(baseline: Baseline, result: ConfigResult): BaselineCheck {
  const ran = new Set(result.runs.map((run) => run.caseId));
  const failing = new Set(result.cases.failing);
  const known = new Set([...baseline.passing, ...baseline.failing]);
  return {
    regressions: baseline.passing.filter((id) => ran.has(id) && failing.has(id)),
    improvements: baseline.failing.filter((id) => ran.has(id) && !failing.has(id)),
    unlisted: [...ran].filter((id) => !known.has(id)).sort(),
  };
}

export async function loadBaseline(path: string): Promise<Baseline | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return baselineSchema.parse(JSON.parse(raw));
}

export async function saveBaseline(path: string, baseline: Baseline): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

export function formatBaselineCheck(check: BaselineCheck): string {
  const lines = [
    check.regressions.length > 0
      ? `  REGRESSED since the baseline: ${check.regressions.join(', ')}`
      : '  no case regressed since the baseline',
    check.improvements.length > 0
      ? `  now passing, not in the baseline yet: ${check.improvements.join(', ')} (npm run eval -- --update-baseline)`
      : '',
    check.unlisted.length > 0
      ? `  not in the baseline yet: ${check.unlisted.join(', ')} (npm run eval -- --update-baseline)`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}

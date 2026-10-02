import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  baselineApplies,
  compareToBaseline,
  formatBaselineCheck,
  loadBaseline,
  saveBaseline,
  toBaseline,
  type Baseline,
} from './baseline';
import type { ConfigResult } from './report';

const result = (passing: string[], failing: string[], repeats = 1): ConfigResult =>
  ({
    label: 'mock v1',
    provider: 'mock',
    model: 'mock-extractive-1',
    promptVersion: 'v1',
    runs: [...passing, ...failing].flatMap((caseId) =>
      Array.from({ length: repeats }, (_, index) => ({ caseId, repeat: index + 1 })),
    ),
    cases: { passed: passing.length, total: passing.length + failing.length, failing },
  }) as unknown as ConfigResult;

const baseline: Baseline = {
  provider: 'mock',
  model: 'mock-extractive-1',
  promptVersion: 'v1',
  passing: ['a', 'b', 'c'],
  failing: ['d'],
};

describe('toBaseline', () => {
  it('records which cases passed and which did not, sorted and without repeats', () => {
    expect(toBaseline(result(['b', 'a'], ['z', 'd'], 3))).toEqual({
      provider: 'mock',
      model: 'mock-extractive-1',
      promptVersion: 'v1',
      passing: ['a', 'b'],
      failing: ['d', 'z'],
    });
  });
});

describe('compareToBaseline', () => {
  it('reports a case that used to pass and now fails, even when the totals would absorb it', () => {
    const check = compareToBaseline(baseline, result(['a', 'b'], ['c', 'd']));

    expect(check.regressions).toEqual(['c']);
    expect(check.improvements).toEqual([]);
  });

  it('notices improvements and cases the baseline has not seen, without failing them', () => {
    const check = compareToBaseline(baseline, result(['a', 'b', 'c', 'd', 'new'], []));

    expect(check).toEqual({ regressions: [], improvements: ['d'], unlisted: ['new'] });
  });

  it('only judges the cases that ran, so a filtered run is not a regression', () => {
    const check = compareToBaseline(baseline, result(['a'], []));

    expect(check).toEqual({ regressions: [], improvements: [], unlisted: [] });
  });

  it('counts a case as failing when any of its repeats failed', () => {
    const flaky = {
      ...result(['a', 'b', 'c'], ['d'], 3),
      cases: { passed: 2, total: 4, failing: ['b', 'd'] },
    } as unknown as ConfigResult;

    expect(compareToBaseline(baseline, flaky).regressions).toEqual(['b']);
  });
});

describe('baselineApplies', () => {
  it('compares only the same provider, model and prompt version', () => {
    expect(baselineApplies(baseline, result([], []))).toBe(true);
    expect(baselineApplies({ ...baseline, promptVersion: 'v2' }, result([], []))).toBe(false);
    expect(baselineApplies({ ...baseline, model: 'other' }, result([], []))).toBe(false);
    expect(baselineApplies({ ...baseline, provider: 'gemini' }, result([], []))).toBe(false);
  });
});

describe('loadBaseline and saveBaseline', () => {
  it('round-trips through a file, creating the folder', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'baseline-')), 'nested', 'baseline.json');

    await saveBaseline(path, baseline);

    expect(await loadBaseline(path)).toEqual(baseline);
  });

  it('treats a missing file as no baseline, and a malformed one as an error', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'baseline-'));
    await writeFile(join(folder, 'bad.json'), JSON.stringify({ provider: 'mock' }));

    expect(await loadBaseline(join(folder, 'missing.json'))).toBeNull();
    await expect(loadBaseline(join(folder, 'bad.json'))).rejects.toThrow();
  });
});

describe('formatBaselineCheck', () => {
  it('says plainly when nothing regressed, and what to do when the baseline is stale', () => {
    expect(formatBaselineCheck({ regressions: [], improvements: [], unlisted: [] })).toBe(
      '  no case regressed since the baseline',
    );
    const text = formatBaselineCheck({ regressions: ['c'], improvements: ['d'], unlisted: ['e'] });
    expect(text).toContain('REGRESSED since the baseline: c');
    expect(text).toContain('now passing, not in the baseline yet: d');
    expect(text).toContain('not in the baseline yet: e');
    expect(text).toContain('--update-baseline');
  });
});

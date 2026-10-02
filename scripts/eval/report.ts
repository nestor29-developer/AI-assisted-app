import type { EvalCase, MetricName, Thresholds } from './golden';
import type { Run } from './run';
import {
  aggregate,
  casePassed,
  checkThresholds,
  scoreCase,
  type Aggregate,
  type CaseScore,
  type ThresholdFailure,
} from './score';

export interface ScoredRun extends Run {
  readonly kind: EvalCase['kind'];
  readonly score: CaseScore | null;
  /** Every check that applies passed; a run that failed before an answer never does. */
  readonly passed: boolean;
}

export interface CaseSummary {
  readonly passed: number;
  readonly total: number;
  /** Ids with at least one failing run. */
  readonly failing: readonly string[];
}

export interface Totals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
  readonly latencyP50Ms: number | null;
  readonly latencyP95Ms: number | null;
  readonly ttftP50Ms: number | null;
}

export interface ConfigResult {
  readonly label: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly runs: readonly ScoredRun[];
  readonly metrics: Aggregate;
  readonly cases: CaseSummary;
  readonly failures: readonly ThresholdFailure[];
  /** Questions that failed before an answer existed; they are not scored, and they fail the run. */
  readonly errors: number;
  readonly totals: Totals;
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

function sumCost(runs: readonly Run[]): number | null {
  const costs = runs.map((run) => run.costUsd);
  return costs.length > 0 && costs.every((cost) => cost !== null)
    ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
    : null;
}

export function summarize(
  identity: Pick<ConfigResult, 'label' | 'provider' | 'model' | 'promptVersion'>,
  runs: readonly Run[],
  cases: ReadonlyMap<string, EvalCase>,
  thresholds: Thresholds,
  canaries: readonly string[] = [],
): ConfigResult {
  const scored = runs.map((run): ScoredRun => {
    const testCase = cases.get(run.caseId);
    if (!testCase) throw new Error(`Run for unknown case ${run.caseId}`);
    const score = run.outcome ? scoreCase(testCase, run.outcome, run.retrieval, canaries) : null;
    return { ...run, kind: testCase.kind, score, passed: score !== null && casePassed(score) };
  });
  const answered = scored.filter((run) => run.outcome !== null);
  const metrics = aggregate(scored.flatMap((run) => (run.score ? [run.score] : [])));

  const outcomes = new Map<string, boolean>();
  for (const run of scored)
    outcomes.set(run.caseId, (outcomes.get(run.caseId) ?? true) && run.passed);
  const failing = [...outcomes].filter(([, ok]) => !ok).map(([id]) => id);

  return {
    ...identity,
    runs: scored,
    metrics,
    cases: { passed: outcomes.size - failing.length, total: outcomes.size, failing },
    failures: checkThresholds(metrics, thresholds),
    errors: scored.length - answered.length,
    totals: {
      inputTokens: answered.reduce((sum, run) => sum + run.inputTokens, 0),
      outputTokens: answered.reduce((sum, run) => sum + run.outputTokens, 0),
      costUsd: sumCost(answered),
      latencyP50Ms: percentile(
        answered.map((run) => run.latencyMs),
        50,
      ),
      latencyP95Ms: percentile(
        answered.map((run) => run.latencyMs),
        95,
      ),
      ttftP50Ms: percentile(
        answered.flatMap((run) => (run.ttftMs === null ? [] : [run.ttftMs])),
        50,
      ),
    },
  };
}

export const passed = (result: ConfigResult): boolean =>
  result.failures.length === 0 && result.errors === 0;

const percent = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const seconds = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(2)} s`);
const dollars = (value: number | null) => (value === null ? 'unknown' : `$${value.toFixed(4)}`);

const SCORE_FLAGS: readonly [keyof CaseScore, string][] = [
  ['schemaValid', 'schema'],
  ['citationsVerified', 'quotes'],
  ['citationsRelevant', 'cited'],
  ['retrievalHit', 'retrieval'],
  ['notFoundCorrect', 'refused'],
  ['injectionResisted', 'resisted'],
];

/** One line per question: what came back, and which checks it passed (+) or failed (-). */
export function formatRun(run: ScoredRun): string {
  const head = `${run.caseId}${run.repeat > 1 ? `#${run.repeat}` : ''}`.padEnd(26);
  if (!run.outcome || !run.score)
    return `${head} ${run.kind.padEnd(12)} FAILED  ${run.failure ?? ''}`;

  const flags = SCORE_FLAGS.flatMap(([key, label]) =>
    typeof run.score?.[key] === 'boolean' ? [`${run.score[key] ? '+' : '-'}${label}`] : [],
  );
  if (run.score.keywordRecall !== null) flags.push(`recall ${run.score.keywordRecall.toFixed(2)}`);
  if (run.score.reciprocalRank) flags.push(`rank ${Math.round(1 / run.score.reciprocalRank)}`);
  return `${head} ${run.kind.padEnd(12)} ${`${run.outcome.status}/${run.outcome.confidence}`.padEnd(26)} ${flags.join('  ')}`;
}

export function formatResult(result: ConfigResult, thresholds: Thresholds): string {
  const failing = new Set(result.failures.map((failure) => failure.metric));
  const rows = (Object.keys(thresholds) as MetricName[]).map((metric) => {
    const value = result.metrics[metric];
    const state = value === null ? 'n/a' : failing.has(metric) ? 'FAIL' : 'pass';
    return `  ${metric.padEnd(22)} ${percent(value).padStart(7)}   needs ${percent(thresholds[metric]).padStart(7)}   ${state}`;
  });
  const { totals } = result;
  return [
    `== ${result.label}`,
    ...rows,
    `  cases passed ${result.cases.passed}/${result.cases.total}${result.cases.failing.length > 0 ? `   not passing: ${result.cases.failing.join(', ')}` : ''}`,
    `  tokens in/out ${totals.inputTokens.toLocaleString('en-US')} / ${totals.outputTokens.toLocaleString('en-US')}, estimated cost ${dollars(totals.costUsd)}`,
    `  latency p50 ${seconds(totals.latencyP50Ms)}, p95 ${seconds(totals.latencyP95Ms)}; first text p50 ${seconds(totals.ttftP50Ms)}`,
    result.errors > 0 ? `  ${result.errors} question(s) failed before an answer existed` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Side by side, for comparing prompt versions or models on the same questions. */
export function formatComparison(results: readonly ConfigResult[]): string {
  const [first] = results;
  if (!first || results.length < 2) return '';
  const metrics = Object.keys(first.metrics) as MetricName[];
  const header = [
    'metric'.padEnd(22),
    ...results.map((result) => result.label.padStart(Math.max(12, result.label.length))),
  ];
  const lines = metrics.map((metric) =>
    [
      metric.padEnd(22),
      ...results.map((result) =>
        percent(result.metrics[metric]).padStart(Math.max(12, result.label.length)),
      ),
    ].join('  '),
  );
  const cost = [
    'estimated cost'.padEnd(22),
    ...results.map((result) =>
      dollars(result.totals.costUsd).padStart(Math.max(12, result.label.length)),
    ),
  ].join('  ');
  return ['== comparison', header.join('  '), ...lines, cost].join('\n');
}

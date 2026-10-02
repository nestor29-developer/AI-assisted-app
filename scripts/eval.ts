import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createAiProviders } from '@/server/ai/providers/factory';
import type { AppConfig } from '@/server/core/config/env';
import { DEFAULT_FULL_CONTEXT_MAX_TOKENS, DEFAULT_RAG_TOP_K } from '@/server/core/constants';

import {
  baselineApplies,
  compareToBaseline,
  formatBaselineCheck,
  loadBaseline,
  saveBaseline,
  toBaseline,
} from './eval/baseline';
import { loadGolden, type EvalCase } from './eval/golden';
import {
  formatComparison,
  formatResult,
  formatRun,
  passed,
  summarize,
  type ConfigResult,
} from './eval/report';
import { runAll } from './eval/run';

const USAGE = `Runs the golden questions through the real pipeline and scores the answers.

  npm run eval                                  offline mock model; checks the plumbing
  npm run eval -- --provider gemini             real model (needs GEMINI_API_KEY in .env)
  npm run eval -- --provider gemini --prompt v1,v2 --model gemini-3.8-flash,gemini-3.5-flash
                                                every prompt x model, side by side

  --provider mock|gemini   default mock
  --prompt v1[,v2]         prompt versions to compare, default v1
  --model a[,b]            Gemini models to compare, default LLM_MODEL or gemini-3.8-flash
  --repeats N              ask each question N times (shows run-to-run variation), default 1
  --seed N                 ask the model for repeatable output
  --cases id[,id]          only these cases
  --delay-ms N             pause between questions (default 0 for mock, 400 for gemini)
  --report PATH            where to write the JSON report (default evals/reports/)
  --update-baseline        record which cases pass now (one prompt and model, all cases, no failed questions)
  --no-fail                print results but always exit 0

A committed baseline (evals/baseline.<provider>.json) makes a case that used to pass and now fails
fail the run, even when the percentages would absorb it.
`;

const AI_DEFAULTS = {
  fullContextMaxTokens: DEFAULT_FULL_CONTEXT_MAX_TOKENS,
  ragTopK: DEFAULT_RAG_TOP_K,
  llmTimeoutMs: 120_000,
  mockChunkDelayMs: 1,
};

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a whole number`);
  return value;
}

function list(raw: string | undefined, fallback: string[]): string[] {
  const items = raw
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : fallback;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      provider: { type: 'string' },
      prompt: { type: 'string' },
      model: { type: 'string' },
      repeats: { type: 'string' },
      seed: { type: 'string' },
      cases: { type: 'string' },
      'delay-ms': { type: 'string' },
      report: { type: 'string' },
      'update-baseline': { type: 'boolean' },
      'no-fail': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const provider = values.provider ?? 'mock';
  if (provider !== 'mock' && provider !== 'gemini')
    throw new Error('--provider must be mock or gemini');
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || undefined;
  if (provider === 'gemini' && !geminiApiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Put it in .env yourself (never paste it into chat or commit it).',
    );
  }

  const prompts = list(values.prompt, ['v1']);
  const models =
    provider === 'mock'
      ? ['mock-extractive-1']
      : list(values.model, [process.env.LLM_MODEL?.trim() || 'gemini-3.8-flash']);
  const repeats = Math.max(1, positiveInt('repeats', values.repeats, 1));
  const delayMs = positiveInt('delay-ms', values['delay-ms'], provider === 'mock' ? 0 : 400);
  const seed = values.seed === undefined ? undefined : positiveInt('seed', values.seed, 0);

  const { golden, documents } = await loadGolden(resolve('evals/golden.json'));
  const wanted = new Set(list(values.cases, []));
  const cases: EvalCase[] = golden.cases.filter(
    (testCase) => wanted.size === 0 || wanted.has(testCase.id),
  );
  const unknown = [...wanted].filter((id) => !golden.cases.some((testCase) => testCase.id === id));
  if (unknown.length > 0) throw new Error(`Unknown case id(s): ${unknown.join(', ')}`);
  const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const thresholds = golden.thresholds[provider];
  const baselinePath = resolve(`evals/baseline.${provider}.json`);
  const baseline = await loadBaseline(baselinePath);

  const results: ConfigResult[] = [];
  let regressions = 0;
  for (const model of models) {
    for (const promptVersion of prompts) {
      const label = provider === 'mock' ? `mock ${promptVersion}` : `${model} ${promptVersion}`;
      const ai: AppConfig['ai'] = {
        ...AI_DEFAULTS,
        provider,
        llmModel: model,
        geminiApiKey,
        embeddingModel: process.env.EMBEDDING_MODEL?.trim() || 'gemini-embedding-2',
        promptVersion,
      };
      console.log(`\n${label}: ${cases.length} question(s) x ${repeats}`);
      const runs = await runAll(
        {
          providers: createAiProviders(ai),
          promptVersion,
          ragTopK: ai.ragTopK,
          fullContextMaxTokens: ai.fullContextMaxTokens,
          ...(seed === undefined ? {} : { seed }),
        },
        documents,
        cases,
        { repeats, delayMs },
      );
      const result = summarize(
        { label, provider, model, promptVersion },
        runs,
        byId,
        thresholds,
        golden.canaries,
      );
      results.push(result);
      console.log(result.runs.map(formatRun).join('\n'));
      console.log(formatResult(result, thresholds));
      if (baseline && baselineApplies(baseline, result)) {
        const check = compareToBaseline(baseline, result);
        regressions += check.regressions.length;
        console.log(formatBaselineCheck(check));
      }
    }
  }

  const comparison = formatComparison(results);
  if (comparison) console.log(`\n${comparison}`);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const reportPath = resolve(values.report ?? `evals/reports/${provider}-${stamp}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify({ provider, repeats, seed: seed ?? null, thresholds, results }, null, 2)}\n`,
  );
  console.log(`\nreport written to ${reportPath}`);

  if (values['update-baseline']) {
    const [only] = results;
    if (results.length !== 1 || !only) {
      throw new Error('--update-baseline needs exactly one prompt and one model');
    }
    if (wanted.size > 0) throw new Error('--update-baseline needs every case, not --cases');
    if (only.errors > 0) throw new Error('--update-baseline refuses a run with failed questions');
    await saveBaseline(baselinePath, toBaseline(only));
    console.log(`baseline written to ${baselinePath}`);
  }

  const ok = results.every(passed) && regressions === 0;
  console.log(
    ok
      ? 'eval passed'
      : 'eval FAILED: a threshold was missed, a case regressed or a question failed',
  );
  return ok || values['no-fail'] ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);

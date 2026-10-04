import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AnswerBadges,
  ConfidenceBadge,
  describeBadges,
  describeConfidence,
} from './confidence-badge';

const verified = { sourceId: 'S1', page: null, quote: 'Employees accrue days', verified: true };
const unverified = { ...verified, quote: 'Invented words here', verified: false };

describe('describeConfidence', () => {
  it.each([
    ['answered', 'high', 'Quotes verified', 'success'],
    ['answered', 'medium', 'Partly verified', 'warning'],
    ['answered', 'low', 'Unverified, double-check', 'danger'],
    ['partially_answered', 'medium', 'Partly verified', 'warning'],
    ['partially_answered', 'low', 'Unverified, double-check', 'danger'],
    ['not_found', 'none', 'No answer found', 'neutral'],
    ['declined', 'none', 'Declined', 'warning'],
    ['unreadable', 'none', 'Reply could not be read', 'danger'],
  ] as const)('%s with %s confidence reads "%s"', (status, confidence, label, tone) => {
    expect(describeConfidence({ status, confidence })).toMatchObject({ label, tone });
  });

  it('lets the outcome win over the confidence: a not-found answer is never called verified', () => {
    expect(describeConfidence({ status: 'not_found', confidence: 'high' }).label).toBe(
      'No answer found',
    );
  });

  it('claims no more than the check did: the quotes exist in their excerpts, not that the answer is right', () => {
    const { hint } = describeConfidence({ status: 'answered', confidence: 'high' });

    expect(hint).toMatch(/excerpt it cites/);
    expect(hint).toMatch(/not that the answer is right/);
  });
});

describe('ConfidenceBadge', () => {
  it('says what the label means for people who cannot see its colour', () => {
    render(<ConfidenceBadge status="answered" confidence="high" />);

    expect(screen.getByText('Quotes verified')).toBeInTheDocument();
    expect(screen.getByText(/Every quote was found in the excerpt it cites/)).toHaveClass(
      'sr-only',
    );
  });

  it('puts the same explanation in a tooltip for people who hover it', () => {
    render(<ConfidenceBadge status="answered" confidence="high" />);

    expect(screen.getByText('Quotes verified').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringMatching(/Every quote was found in the excerpt it cites/),
    );
  });
});

describe('AnswerBadges', () => {
  const answer = (overrides: Parameters<typeof describeBadges>[0]) => overrides;

  it('shows only "Partial answer" when it is partial and every quote was verified', () => {
    const partial = answer({
      status: 'partially_answered',
      confidence: 'medium',
      citations: [verified, verified],
    });

    render(<AnswerBadges answer={partial} />);

    expect(screen.getByText('Partial answer')).toBeInTheDocument();
    expect(screen.queryByText('Partly verified')).not.toBeInTheDocument();
    expect(describeBadges(partial)).toEqual(['Partial answer']);
  });

  it('keeps both badges when a partial answer has a quote that was not verified', () => {
    const partial = answer({
      status: 'partially_answered',
      confidence: 'medium',
      citations: [verified, unverified],
    });

    render(<AnswerBadges answer={partial} />);

    expect(screen.getByText('Partial answer')).toBeInTheDocument();
    expect(screen.getByText('Partly verified')).toBeInTheDocument();
    expect(describeBadges(partial)).toEqual(['Partly verified', 'Partial answer']);
  });

  it('keeps both badges when a partial answer cites nothing', () => {
    const partial = answer({ status: 'partially_answered', confidence: 'low', citations: [] });

    expect(describeBadges(partial)).toEqual(['Unverified, double-check', 'Partial answer']);
  });

  it('shows one badge for a complete answer', () => {
    expect(
      describeBadges(answer({ status: 'answered', confidence: 'high', citations: [verified] })),
    ).toEqual(['Quotes verified']);
  });
});

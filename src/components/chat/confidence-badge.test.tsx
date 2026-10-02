import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfidenceBadge, describeConfidence } from './confidence-badge';

describe('describeConfidence', () => {
  it.each([
    ['answered', 'high', 'Grounded in the document', 'success'],
    ['answered', 'medium', 'Partly verified', 'warning'],
    ['answered', 'low', 'Unverified, double-check', 'danger'],
    ['partially_answered', 'medium', 'Partly verified', 'warning'],
    ['partially_answered', 'low', 'Unverified, double-check', 'danger'],
    ['not_found', 'none', 'Not found in the document', 'neutral'],
    ['declined', 'none', 'Declined', 'warning'],
    ['unreadable', 'none', 'Reply could not be read', 'danger'],
  ] as const)('%s with %s confidence reads "%s"', (status, confidence, label, tone) => {
    expect(describeConfidence({ status, confidence })).toMatchObject({ label, tone });
  });

  it('lets the outcome win over the confidence: a not-found answer is never called grounded', () => {
    expect(describeConfidence({ status: 'not_found', confidence: 'high' }).label).toBe(
      'Not found in the document',
    );
  });
});

describe('ConfidenceBadge', () => {
  it('says what the label means for people who cannot see its colour', () => {
    render(<ConfidenceBadge status="answered" confidence="high" />);

    expect(screen.getByText('Grounded in the document')).toBeInTheDocument();
    expect(screen.getByText(/Every quote was found in the document/)).toHaveClass('sr-only');
  });
});

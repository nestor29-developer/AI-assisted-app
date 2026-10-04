import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { findQuoteRanges, SourceExcerpt } from './source-excerpt';

const TEXT =
  'Meals are reimbursed up to 60 dollars per day.\nReceipts are required above 25 dollars.';

const slice = (text: string, ranges: ReturnType<typeof findQuoteRanges>) =>
  ranges.map(([start, end]) => text.slice(start, end));

describe('findQuoteRanges', () => {
  it('finds a quote whatever its case', () => {
    expect(slice(TEXT, findQuoteRanges(TEXT, ['MEALS ARE REIMBURSED up to 60 dollars']))).toEqual([
      'Meals are reimbursed up to 60 dollars',
    ]);
  });

  it('finds a quote across a line break, extra spaces or different punctuation', () => {
    const quote = 'per   day,  receipts are required';

    expect(slice(TEXT, findQuoteRanges(TEXT, [quote]))).toEqual([
      'per day.\nReceipts are required',
    ]);
  });

  it('says nothing when the quote is not in the text, so the excerpt stays plain', () => {
    expect(findQuoteRanges(TEXT, ['Meals are free on Fridays'])).toEqual([]);
    expect(findQuoteRanges(TEXT, ['...'])).toEqual([]);
  });

  it('keeps several quotes in text order and merges the ones that overlap', () => {
    const ranges = findQuoteRanges(TEXT, [
      'Receipts are required above 25 dollars',
      'reimbursed up to 60 dollars',
      'up to 60 dollars per day',
    ]);

    expect(slice(TEXT, ranges)).toEqual([
      'reimbursed up to 60 dollars per day',
      'Receipts are required above 25 dollars',
    ]);
  });

  it('copes with a quote full of characters that mean something in a pattern', () => {
    expect(findQuoteRanges('Pay (60 dollars) [max]. Done.', ['(60 dollars) [max].*'])).toHaveLength(
      1,
    );
  });
});

describe('SourceExcerpt', () => {
  it('marks the verified quote inside the excerpt', () => {
    const { container } = render(
      <SourceExcerpt
        text={TEXT}
        quotes={['receipts are required above 25 dollars']}
        label="Text of source S1"
        open={false}
      />,
    );

    const mark = container.querySelector('mark');
    expect(mark).toHaveTextContent('Receipts are required above 25 dollars');
    expect(container.textContent).toBe(TEXT);
  });

  it('shows plain text when no quote can be found in it', () => {
    const { container } = render(
      <SourceExcerpt
        text={TEXT}
        quotes={['nothing like this']}
        label="Text of source S1"
        open={false}
      />,
    );

    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe(TEXT);
  });

  it('stays a named, focusable group, so a keyboard user can scroll it', () => {
    render(<SourceExcerpt text={TEXT} quotes={[]} label="Text of source S1" open={false} />);

    const group = screen.getByRole('group', { name: 'Text of source S1' });
    expect(group).toHaveAttribute('tabindex', '0');
  });

  it('scrolls the excerpt, and only the excerpt, to the quote when it opens', () => {
    const rect = (top: number) => ({ top }) as DOMRect;
    const { container, rerender } = render(
      <SourceExcerpt
        text={TEXT}
        quotes={['receipts are required']}
        label="Text of source S1"
        open={false}
      />,
    );
    const box = screen.getByRole('group');
    const mark = container.querySelector('mark')!;
    Object.defineProperty(box, 'clientHeight', { value: 240, configurable: true });
    Object.defineProperty(mark, 'offsetHeight', { value: 20, configurable: true });
    box.getBoundingClientRect = () => rect(100);
    mark.getBoundingClientRect = () => rect(433);
    expect(box.scrollTop).toBe(0);

    rerender(
      <SourceExcerpt
        text={TEXT}
        quotes={['receipts are required']}
        label="Text of source S1"
        open
      />,
    );

    expect(box.scrollTop).toBe(433 - 100 - (240 - 20) / 2);
  });

  it('does not scroll while it is closed', () => {
    const { container } = render(
      <SourceExcerpt
        text={TEXT}
        quotes={['receipts are required']}
        label="Text of source S1"
        open={false}
      />,
    );

    expect(screen.getByRole('group').scrollTop).toBe(0);
    expect(container.querySelector('mark')).not.toBeNull();
  });
});

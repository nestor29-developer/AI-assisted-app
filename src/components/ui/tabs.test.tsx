import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { panelId, Tabs, type TabItem } from './tabs';

type Id = 'one' | 'two' | 'three';
const TABS: readonly TabItem<Id>[] = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two' },
  { id: 'three', label: 'Three' },
];

function Harness() {
  const [value, setValue] = useState<Id>('one');
  return (
    <>
      <Tabs label="Pick" idPrefix="t" tabs={TABS} value={value} onValueChange={setValue} />
      <output>{value}</output>
    </>
  );
}

const selected = () => screen.getByRole('tab', { selected: true });

describe('Tabs', () => {
  it('moves with the arrow keys, wrapping around at both ends', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'One' }));

    await user.keyboard('{ArrowLeft}');
    expect(selected()).toHaveTextContent('Three');
    expect(selected()).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(selected()).toHaveTextContent('One');
  });

  it('jumps to the first and last tab with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'Two' }));

    await user.keyboard('{End}');
    expect(selected()).toHaveTextContent('Three');
    expect(selected()).toHaveFocus();

    await user.keyboard('{Home}');
    expect(selected()).toHaveTextContent('One');
    expect(selected()).toHaveFocus();
  });

  it('leaves the browser’s own shortcuts alone', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'One' }));

    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await user.keyboard('{Meta>}{ArrowRight}{/Meta}');
    await user.keyboard('{Control>}{End}{/Control}');

    expect(selected()).toHaveTextContent('One');
  });

  it('draws the selected tab with an underline, not with a background alone', () => {
    render(<Harness />);

    expect(selected()).toHaveClass('underline');
    expect(screen.getByRole('tab', { name: 'Two' })).not.toHaveClass('underline');
  });

  it('names the panel each tab controls', () => {
    render(<Harness />);

    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute(
      'aria-controls',
      panelId('t', 'two'),
    );
  });
});

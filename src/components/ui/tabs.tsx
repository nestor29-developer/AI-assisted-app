'use client';

import { useRef, type KeyboardEvent } from 'react';

export interface TabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/** The index a key moves to, or null for keys that are not ours. */
function targetIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** An accessible tab list: arrow keys, Home and End move between tabs. The caller renders every tabpanel. */
export function Tabs<Id extends string>({
  label,
  idPrefix,
  tabs,
  value,
  onValueChange,
}: {
  readonly label: string;
  readonly idPrefix: string;
  readonly tabs: readonly TabItem<Id>[];
  readonly value: Id;
  readonly onValueChange: (id: Id) => void;
}) {
  const refs = useRef(new Map<Id, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Alt+Arrow and Cmd+Arrow are the browser's own history shortcuts.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = tabs.findIndex((tab) => tab.id === value);
    const index = targetIndex(event.key, current, tabs.length);
    if (index === null) return;
    event.preventDefault();
    const next = tabs[index];
    if (!next) return;
    onValueChange(next.id);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-lg bg-slate-100 p-1"
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(tab.id)}
            className={`h-8 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
              selected
                ? 'bg-white text-slate-900 underline decoration-indigo-600 decoration-2 underline-offset-4 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

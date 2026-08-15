import type { ReactElement, ReactNode } from 'react';
import type { ValueStore } from '@markii/runtime';

export interface ValueDirectiveProps {
  store: ValueStore | undefined;
  children?: ReactNode;
}

/**
 * Flattens a directive's already-rendered inner markdown back down to
 * plain text. `:value[name]` is defined as carrying a bare value name in
 * its label (§8) — by the time this component sees it, the pipeline has
 * already turned that label into React children (ordinarily a single text
 * string), so this just undoes that for the one case we need: nested
 * markup inside the label (which the format never asks authors to write)
 * contributes nothing rather than throwing.
 */
function extractPlainText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractPlainText).join('');
  return '';
}

/** Coerces a stored value to display text. Objects/arrays render as JSON; `null`/`undefined` render as an empty string. */
function stringifyStoredValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * `:value[name]` (DESIGN.md §8) — renders a named value from the value
 * store inline. Built into the renderer (see `render.tsx`'s
 * `createDirectiveElement`), not a registry entry: it is part of the
 * render-time interpolation contract, resolved before any component
 * lookup. Never throws: no store, an empty name, or a name the store
 * doesn't (yet) have all render the same graceful missing-value marker —
 * the same degrade-gracefully spirit as the unknown-directive fallback,
 * just for values instead of components.
 */
export function ValueDirective({
  store,
  children,
}: ValueDirectiveProps): ReactElement {
  const name = extractPlainText(children).trim();
  const entry = name ? store?.get(name) : undefined;

  if (!entry || entry.status === 'missing' || entry.status === 'error') {
    return (
      <span
        className="mk-value mk-value--missing"
        title={entry?.error ?? undefined}
      >
        {name ? `{${name}}` : '{value}'}
      </span>
    );
  }

  const className =
    entry.status === 'stale' ? 'mk-value mk-value--stale' : 'mk-value';
  return <span className={className}>{stringifyStoredValue(entry.value)}</span>;
}

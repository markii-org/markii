import type { ReactElement, ReactNode } from 'react';
import type { FailureKind, ValueStore, VaultStore } from '@markii/runtime';
import { resolveScopedPath } from '../store-path.js';

/**
 * Human-facing phrase per `FailureKind` (`@markii/runtime`) — this is the
 * ONE place UI text for the failure taxonomy lives; `@markii/runtime` itself
 * carries no presentation. Deliberately short (fits a tooltip/title, and a
 * future inline-badge use) — the full underlying message is still available
 * separately (see `titleFor`).
 */
const FAILURE_PHRASE: Record<FailureKind, string> = {
  'script-error': 'script error',
  'capability-denied': 'needs permission',
  'tier-blocked': 'requires manual run',
  limit: 'limit exceeded',
};

/**
 * The marker's `title` attribute (tooltip) for an error/missing resolution.
 * When a `failureKind` is present, leads with its short phrase (see
 * `FAILURE_PHRASE`) and appends the underlying message if there is one —
 * the message is never dropped, only led with a human-readable summary. An
 * error/missing resolution with NO `failureKind` at all (a hand-built
 * fixture, a pre-taxonomy stored value, or a genuinely missing name with no
 * error) degrades to exactly what this component has always shown: the raw
 * message, or nothing.
 */
function titleFor(
  error: string | undefined,
  failureKind: FailureKind | undefined,
): string | undefined {
  if (!failureKind) return error ?? undefined;
  const phrase = FAILURE_PHRASE[failureKind];
  return error ? `${phrase}: ${error}` : phrase;
}

export interface ValueDirectiveProps {
  store: ValueStore | undefined;
  vault?: VaultStore;
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
 * store inline. `name` may be a dotted path (`repo.stars`) reaching into a
 * stored object/array, resolved via `resolveScopedPath` (`../store-path`) —
 * a bare name works exactly as before. An `@`-prefixed name (`@gh.stars`)
 * resolves against `vault` instead of `store` (§8: "bare name = mine,
 * `@name` = the vault's") and degrades through every missing/stale/error
 * path identically to a bare name — the marker shows the name exactly as
 * written, including the `@`. Built into the renderer (see `render.tsx`'s
 * `createDirectiveElement`), not a registry entry: it is part of the
 * render-time interpolation contract, resolved before any component
 * lookup. Never throws: no store/vault, an empty name, or a path that
 * doesn't (yet) resolve all render the same graceful missing-value marker —
 * the same degrade-gracefully spirit as the unknown-directive fallback,
 * just for values instead of components.
 */
export function ValueDirective({
  store,
  vault,
  children,
}: ValueDirectiveProps): ReactElement {
  const name = extractPlainText(children).trim();
  const resolved = name ? resolveScopedPath({ store, vault }, name) : undefined;

  if (
    !resolved ||
    resolved.status === 'missing' ||
    resolved.status === 'error'
  ) {
    // Only a genuine ERROR resolution (the script actually ran and failed)
    // ever drives kind-specific presentation — a plain `'missing'`
    // resolution (no run ever produced this name, or a dotted path that
    // didn't fully resolve) never invents one, even if a partial-path miss
    // happened to carry a stale `failureKind` through from its root entry
    // (see `store-path.ts`'s `walkSegments`). An error with no `failureKind`
    // at all degrades to EXACTLY what this component has always rendered.
    const failureKind =
      resolved?.status === 'error' ? resolved.failureKind : undefined;
    const className = failureKind
      ? `mk-value mk-value--missing mk-value--${failureKind}`
      : 'mk-value mk-value--missing';
    return (
      <span
        className={className}
        title={titleFor(resolved?.error, failureKind)}
      >
        {name ? `{${name}}` : '{value}'}
      </span>
    );
  }

  const className =
    resolved.status === 'stale' ? 'mk-value mk-value--stale' : 'mk-value';
  return (
    <span className={className}>{stringifyStoredValue(resolved.value)}</span>
  );
}

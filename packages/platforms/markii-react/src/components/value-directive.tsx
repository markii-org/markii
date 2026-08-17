import type { ReactElement, ReactNode } from 'react';
import type { ValueStore, VaultStore } from '@markii/runtime';
import { resolveScopedPath } from '../store-path.js';
import { failureKindClass, failureTitle } from './failure-presentation.js';

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

/**
 * `String(value)` for a value that may be actively hostile — a revoked
 * `Proxy`, an object with a throwing `toString`/`Symbol.toPrimitive`, an
 * `Object.create(null)` with no `toString` at all. All of those make plain
 * `String(...)` throw; an unrenderable value degrades to the empty string
 * instead, which is what a `null`/`undefined` value already renders as.
 */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '';
  }
}

/**
 * Coerces a stored value to display text. Objects/arrays render as JSON;
 * `null`/`undefined` render as an empty string.
 *
 * Never throws, for ANY stored value. The `typeof`/`=== null` checks above
 * the `try` are the only operators safe to run unguarded on an untrusted
 * value (a `Proxy` can intercept neither), and the values they accept are
 * primitives `String` can never fail on. Everything below is guarded twice:
 * `JSON.stringify` can throw (a cycle, a `BigInt`, a throwing `toJSON`, a
 * `Proxy` trap) AND can legitimately return `undefined` (a function, a
 * symbol) despite its `string` type signature — which renders as nothing,
 * as it always has — and the `String(value)` fallback can throw for exactly
 * the same value that made `JSON.stringify` throw, so it goes through
 * `safeString` rather than being the last unguarded step.
 */
function stringifyStoredValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    const json: string | undefined = JSON.stringify(value);
    return json ?? '';
  } catch {
    return safeString(value);
  }
}

/**
 * `:value[name]` (docs/scripting.md) — renders a named value from the value
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
    // The kind modifier comes from `failureKindClass`, not string
    // interpolation here: it is only ever emitted for a value that passed
    // the closed-set check in `./failure-presentation`, so an out-of-
    // taxonomy `failureKind` on a hand-built store entry can never reach a
    // class attribute.
    const kindClass = failureKindClass('mk-value', failureKind);
    const className = kindClass
      ? `mk-value mk-value--missing ${kindClass}`
      : 'mk-value mk-value--missing';
    return (
      <span
        className={className}
        title={failureTitle(resolved?.error, failureKind)}
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

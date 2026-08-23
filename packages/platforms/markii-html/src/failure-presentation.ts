import type { FailureKind, ValueStatus } from '@markii/runtime';

/**
 * The `@markii/html` port of `@markii/react`'s `components/failure-
 * presentation.ts` — the ONE place UI wording and CSS-class hooks for
 * `@markii/runtime`'s failure taxonomy live in this engine. Ported (not
 * imported) for the same reason `./resolve.ts` is ported: the module is not
 * part of `@markii/react`'s public export surface, and the two renderers are
 * independent implementations of the same presentation contract
 * (docs/scripting.md), kept identical in wording and class vocabulary so a
 * failing name reads the same in both.
 *
 * The presentation contract (AGENTS.md's cleanliness principle): a failure
 * NEVER becomes body text. It surfaces as exactly two things — a `title`
 * tooltip and a modifier class — layered on the component's quiet empty/
 * stale state.
 */

/** Human-facing phrase per `FailureKind`. Null-prototype so an out-of-taxonomy `kind` can never resolve through the prototype chain. */
const FAILURE_PHRASE: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    'script-error': 'script error',
    'capability-denied': 'needs permission',
    'tier-blocked': 'requires manual run',
    limit: 'limit exceeded',
  } satisfies Record<FailureKind, string>,
);

/** The short phrase for `kind`, or `undefined` if absent or not one of the four taxonomy members. */
export function failurePhrase(
  kind: FailureKind | undefined,
): string | undefined {
  if (kind === undefined) return undefined;
  return Object.hasOwn(FAILURE_PHRASE, kind) ? FAILURE_PHRASE[kind] : undefined;
}

/** The `title` (tooltip) text for a failed/missing binding: the short phrase for `kind`, with `error` appended when there is one. */
export function failureTitle(
  error: string | undefined,
  kind: FailureKind | undefined,
): string | undefined {
  const phrase = failurePhrase(kind);
  if (!phrase) return error ? error : undefined;
  return error ? `${phrase}: ${error}` : phrase;
}

/** The BEM-ish modifier class for `kind` under `base`, or `undefined` when `kind` is absent or out of taxonomy. */
export function failureKindClass(
  base: string,
  kind: FailureKind | undefined,
): string | undefined {
  if (kind === undefined || !failurePhrase(kind)) return undefined;
  return `${base}--${kind}`;
}

/**
 * The full class list for a data-bound component's root element: `base`,
 * plus `<base>--stale` for a stale binding, plus `<base>--<failureKind>` when
 * the binding failed with a recognized kind. `extra` (a component's own
 * state modifiers, e.g. `mk-chart--empty`) is kept adjacent to the base.
 */
export function dataStateClassName(
  base: string,
  status: ValueStatus | undefined,
  kind: FailureKind | undefined,
  extra?: readonly string[],
): string {
  const classes = [base, ...(extra ?? [])];
  if (status === 'stale') classes.push(`${base}--stale`);
  const kindClass = failureKindClass(base, kind);
  if (kindClass) classes.push(kindClass);
  return classes.join(' ');
}

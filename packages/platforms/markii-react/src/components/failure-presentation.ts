import type { FailureKind, ValueStatus } from '@markii/runtime';

/**
 * The ONE place UI text and CSS-class hooks for `@markii/runtime`'s failure
 * taxonomy (`FailureKind`, DESIGN.md §8) live. `@markii/runtime` itself
 * carries no presentation — it classifies, this module words and styles —
 * and every renderer-side consumer (`ValueDirective` for `:value[...]`, the
 * data-bound `stat`/`progress`/`chart` components) goes through here, so the
 * wording and the class vocabulary can never drift apart between an inline
 * value and a component bound to the same failing name.
 *
 * The presentation contract this module encodes (AGENTS.md's cleanliness
 * principle: "the rendered page shows quiet markers ... never error dumps"):
 * a failure NEVER becomes body text. It surfaces as exactly two things — a
 * `title` tooltip and a modifier class — layered on whatever quiet empty/
 * stale state the component already renders.
 */

/**
 * Human-facing phrase per `FailureKind`. Deliberately short (it has to fit a
 * tooltip, and read sensibly when a longer underlying message is appended
 * after it). Null-prototype so a hostile or merely out-of-taxonomy `kind`
 * (`'__proto__'`, `'constructor'`, `'toString'`) can never resolve through
 * the prototype chain to an inherited `Object.prototype` member — the same
 * defense `layout.ts`'s class maps and `@markii/stdlib`'s `getContract` use.
 */
const FAILURE_PHRASE: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    'script-error': 'script error',
    'capability-denied': 'needs permission',
    'tier-blocked': 'requires manual run',
    limit: 'limit exceeded',
  } satisfies Record<FailureKind, string>,
);

/**
 * The short phrase for `kind`, or `undefined` if `kind` is absent or is not
 * one of the four taxonomy members. `kind` is typed as `FailureKind` at
 * every call site, but it originates in a `ValueStore` entry — which a host
 * app, a test fixture, or a pre-taxonomy persisted document can populate by
 * hand — so it is validated here at runtime rather than trusted. An
 * unrecognized value degrades to "no failure presentation at all", exactly
 * like an absent one.
 */
export function failurePhrase(
  kind: FailureKind | undefined,
): string | undefined {
  if (kind === undefined) return undefined;
  return Object.hasOwn(FAILURE_PHRASE, kind) ? FAILURE_PHRASE[kind] : undefined;
}

/**
 * The `title` (tooltip) text for a failed/missing binding: the short phrase
 * for `kind`, with the underlying `error` message appended when there is one
 * — the message is never dropped, only led with a human-readable summary.
 * With no recognized `kind` (absent, or out of taxonomy), degrades to the
 * raw `error` message alone, or `undefined` when there is neither. Never
 * returns an empty string, so a caller can pass the result straight to
 * `title=` without producing an empty tooltip attribute.
 */
export function failureTitle(
  error: string | undefined,
  kind: FailureKind | undefined,
): string | undefined {
  const phrase = failurePhrase(kind);
  if (!phrase) return error ? error : undefined;
  return error ? `${phrase}: ${error}` : phrase;
}

/**
 * The BEM-ish modifier class for `kind` under `base` (e.g.
 * `failureKindClass('mk-stat', 'tier-blocked')` -> `'mk-stat--tier-blocked'`),
 * or `undefined` when `kind` is absent or out of taxonomy. Because the
 * suffix is only ever produced for a value that passed `failurePhrase`'s
 * closed-set check, a hand-built store entry carrying
 * `failureKind: '"><script>'` can never be interpolated into a class
 * attribute — it simply yields no class, the same as no failure at all.
 */
export function failureKindClass(
  base: string,
  kind: FailureKind | undefined,
): string | undefined {
  if (kind === undefined || !failurePhrase(kind)) return undefined;
  return `${base}--${kind}`;
}

/**
 * The full class list for a data-bound component's root element: `base`,
 * plus `<base>--stale` for a stale binding, plus `<base>--<failureKind>`
 * when the binding failed with a recognized kind. `extra` (a component's own
 * state modifiers, e.g. `mk-chart--empty`) is kept adjacent to the base so
 * the status/failure hooks always come last and read consistently across
 * components.
 *
 * Status/failure hooks are CLASSES ONLY — the visible body of the component
 * is unchanged by this function. That is the whole point: a reader sees the
 * component's ordinary quiet empty state, a stylesheet can tint it, and the
 * tooltip (see `failureTitle`) carries the words.
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

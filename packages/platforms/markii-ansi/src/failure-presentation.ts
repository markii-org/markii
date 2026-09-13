import type { FailureKind, ValueStatus } from './value-types.js';
import type { Tier1Token } from './theme.js';

/**
 * This engine's port of `@markii/html`'s `failure-presentation.ts` — the ONE
 * place UI wording for `@markii/runtime`'s failure taxonomy lives in this
 * engine. Ported (not imported) for the same reason `./resolve.ts` is
 * ported: each platform renderer independently implements the same
 * presentation contract (docs/scripting.md), kept identical in wording so a
 * failing name reads the same everywhere. `failure-presentation.drift.test.ts`
 * is the executable proof: it reads `@markii/html`'s copy of this module as
 * TEXT and asserts the phrases and title templates match byte for byte.
 *
 * The presentation contract (AGENTS.md's cleanliness principle) carries over
 * unchanged: a failure never becomes body text. In a terminal it surfaces as
 * a quiet trailing marker (`dataStateSuffix`) plus, where the caller wants
 * it, a themed color (`failureToken`) — the terminal's equivalent of the
 * HTML engine's `title` tooltip and modifier class, since neither exists in
 * a terminal.
 *
 * Two notices (an out-of-enum attribute value, a refused image source) carry
 * a full sentence in the browser engines' `title` tooltip, reached out of
 * the text flow. A terminal has no tooltip, so printing that sentence inline
 * would put the reason back in the rendered note. `invalidAttributeValueLabel`
 * and `unsafeImageSrcLabel` are this engine's short inline labels for those
 * two cases; the full sentence (`invalidAttributeValueTitle`/
 * `unsafeImageSrcTitle`, unchanged) still reaches a host only through
 * `onDiagnostic`.
 */

/** Human-facing phrase per `FailureKind`. Identical wording to `@markii/html`'s `FAILURE_PHRASE`; kept in sync by `failure-presentation.drift.test.ts`. Null-prototype so an out-of-taxonomy `kind` can never resolve through the prototype chain. */
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

/** The tooltip-equivalent text for a failed/missing binding: the short phrase for `kind`, with `error` appended when there is one. */
export function failureTitle(
  error: string | undefined,
  kind: FailureKind | undefined,
): string | undefined {
  const phrase = failurePhrase(kind);
  if (!phrase) return error ? error : undefined;
  return error ? `${phrase}: ${error}` : phrase;
}

/**
 * The theme token a failed binding's marker is colored with, this engine's
 * terminal equivalent of `@markii/html`'s `failureKindClass`: `script-error`
 * and `capability-denied` both read as `--mk-danger` (the note asked for
 * something and could not get it, one way or another), `tier-blocked` reads
 * as `--mk-warning` (a manual run would fix it, nothing is actually broken),
 * `limit` reads as `--mk-limit`'s dedicated purple. `undefined` for an
 * absent or out-of-taxonomy `kind`, in which case a caller applies no color
 * at all rather than guessing one.
 */
export function failureToken(
  kind: FailureKind | undefined,
): Tier1Token | undefined {
  if (kind === 'script-error' || kind === 'capability-denied')
    return '--mk-danger';
  if (kind === 'tier-blocked') return '--mk-warning';
  if (kind === 'limit') return '--mk-limit';
  return undefined;
}

/**
 * The quiet trailing marker text for a data-bound value's state: ` (stale)`
 * for a stale value, ` (<phrase>)` for a failed one (built from the SAME
 * `FAILURE_PHRASE` table `failureTitle` uses, so the two never say something
 * different about the same failure), `''` for a fresh or plain-missing
 * value (a plain miss already shows as the empty/placeholder marker
 * `render.ts` builds; it needs no additional suffix). `status: 'error'`
 * without a recognized `kind` still gets the generic wording via
 * `failurePhrase`'s `undefined` fallback in the caller.
 */
export function dataStateSuffix(
  status: ValueStatus | undefined,
  kind: FailureKind | undefined,
): string {
  if (status === 'error') {
    const phrase = failurePhrase(kind) ?? 'error';
    return ` (${phrase})`;
  }
  if (status === 'stale') return ' (stale)';
  return '';
}

/**
 * The marker text `render.ts` shows for an INLINE-registered component that
 * receives no content (e.g. `::badge{label="x"}`, text put in an attribute
 * instead of the directive body). Wording identical to `@markii/html`'s
 * `emptyInlineTitle`.
 */
export function emptyInlineTitle(name: string): string {
  return `${name}: no content (an attribute may have been used where directive text was expected)`;
}

/** The marker text for a known attribute's value outside its closed enum. Wording identical to `@markii/html`'s `invalidAttributeValueTitle`. */
export function invalidAttributeValueTitle(
  directive: string,
  attribute: string,
  value: string,
): string {
  return `${directive}: "${value}" is not a valid ${attribute} value (ignored)`;
}

/** The marker text for a component-built image whose `src` was refused as unsafe. Wording identical to `@markii/html`'s `unsafeImageSrcTitle`. */
export function unsafeImageSrcTitle(directive: string): string {
  return `${directive}: image source was refused as unsafe and was not shown`;
}

/**
 * The INLINE marker text for a known attribute's value outside its closed
 * enum, this engine's own departure from `@markii/html`'s identical wording:
 * a terminal has no tooltip to carry `invalidAttributeValueTitle`'s full
 * sentence out of the text flow, so printing that sentence inline would put
 * the reason back in the page, the exact thing AGENTS.md's "clean is not
 * silent" rule exists to prevent. This short label is what render.ts prints
 * next to the component's own output; the full sentence still reaches a
 * host's diagnostics surface via `onDiagnostic`.
 */
export function invalidAttributeValueLabel(
  directive: string,
  attribute: string,
): string {
  return `${directive}: ${attribute} ignored`;
}

/**
 * The INLINE marker text for a component-built image whose `src` was
 * refused as unsafe, this engine's short counterpart to
 * `unsafeImageSrcTitle` for the same reason `invalidAttributeValueLabel`
 * exists: no tooltip channel, so the full sentence goes to `onDiagnostic`
 * only.
 */
export function unsafeImageSrcLabel(directive: string): string {
  return `${directive}: image not shown`;
}

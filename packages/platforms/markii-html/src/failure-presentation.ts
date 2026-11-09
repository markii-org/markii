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

/**
 * The class `render.ts` wraps an INLINE-registered component in when it
 * receives no content (e.g. `::badge{label="x"}`, text put in an attribute
 * instead of the directive body). Ported from `@markii/react`'s copy of this
 * module so both engines say and style the same thing; see that copy's doc
 * comment for the full rationale.
 */
export const EMPTY_INLINE_MARKER_CLASS = 'mk-inline-empty';

/** The `title` tooltip for `EMPTY_INLINE_MARKER_CLASS`. Ported verbatim from `@markii/react`. */
export function emptyInlineTitle(name: string): string {
  return `${name}: no content (an attribute may have been used where directive text was expected)`;
}

/**
 * The attribute both engines set on a component's own rendered output for a
 * quiet marker over a recognized-and-declined value (a known attribute's
 * value outside its enum, or a `figure` `src` refused as unsafe). Ported
 * from `@markii/react`'s copy; see that copy's doc comment for the full
 * rationale.
 */
export const NOTICE_ATTRIBUTE = 'data-mk-notice';

/** The `title` tooltip for `NOTICE_ATTRIBUTE` on an enum mismatch. Ported verbatim from `@markii/react`. */
export function invalidAttributeValueTitle(
  directive: string,
  attribute: string,
  value: string,
): string {
  return `${directive}: "${value}" is not a valid ${attribute} value (ignored)`;
}

/** The `title` tooltip for `NOTICE_ATTRIBUTE` on a `figure` with a refused `src`. Ported verbatim from `@markii/react`. */
export function unsafeImageSrcTitle(directive: string): string {
  return `${directive}: image source was refused as unsafe and was not shown`;
}

/** The diagnostic text for a host `renderCode` callback that threw; the code block rendered as usual. Identical across the engines. */
export function codeRendererFailedTitle(): string {
  return 'code block: the host code renderer failed, so the plain block was shown';
}

/** The diagnostic text for a registered block component written as an inline directive, which renders as the inline fallback instead. */
export function formMismatchTitle(directive: string): string {
  return `${directive}: block component was written inline and was not rendered`;
}

/**
 * The words of a fallback label for a directive that names a component of
 * an installed pack with no view in this engine. Followed by the directive
 * name in a `<code>` element. A static HTML file is what this engine makes,
 * so that is what the label calls the missing view.
 */
export const NO_ENGINE_VIEW_LABEL = 'no HTML view for';

/**
 * The diagnostic text for the same case (also the fallback box's tooltip):
 * the pack, and the engines the component does ship a view for.
 */
export function noEngineViewTitle(
  directive: string,
  pack: string,
  engines: readonly string[],
): string {
  const has =
    engines.length > 0
      ? `it has views for: ${engines.join(', ')}`
      : 'it has no views for any engine';
  return `The ${pack} pack has no HTML view for this component; ${has}`;
}

/**
 * The visible separator between an inline fallback's label and its content,
 * emitted as real text (`mk-unknown__separator`) so a copy or a plain-text
 * export reads the same as `@markii/ansi`'s output. An inline fallback with
 * no content shows the bare label and no separator.
 */
export const INLINE_FALLBACK_SEPARATOR = ': ';

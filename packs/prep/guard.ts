/**
 * Shared defensive helpers for the `prep` pack, following the same shape
 * as `packs/tech/guard.ts`.
 *
 * Most of `prep`'s components read nothing but attributes: an interview
 * question, a confidence rating, and a pitfall note are all typed into
 * the note by hand. Attributes arrive as untrusted strings (or `null` for
 * a bare attribute), so every attribute read goes through one of the
 * first helpers below. A missing, oversized, or nonsense value degrades
 * to a quiet default rather than throwing.
 *
 * `prep_quiz` is the one component here that reads a bound `data=` value,
 * which a script produced and which can be anything at all, including a
 * revoked `Proxy` or an object whose getters throw. The helpers at the
 * bottom (`safeExtract`, `failureTitle`, `stateClassName`, `isUnreadable`)
 * are the same shape `packs/dash` and `packs/track` use for that, so the
 * three packs guard a binding the same way.
 */

/**
 * A generous but finite cap on any single displayed string. An attribute
 * comes straight out of the note, so nothing stops an author from pasting
 * ten thousand characters into `q=`; without a cap that reaches the DOM
 * unbounded.
 */
const MAX_TEXT_LENGTH = 500;

/** Coerces an unknown value to a trimmed string capped at `MAX_TEXT_LENGTH`, or `fallback`. */
export function str(raw: unknown, fallback = ''): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  return trimmed.length > MAX_TEXT_LENGTH
    ? trimmed.slice(0, MAX_TEXT_LENGTH)
    : trimmed;
}

/**
 * Like `str`, but tells "written as an empty string" apart from "not
 * written at all": a non-string (including the `null` a bare attribute
 * arrives as) yields `undefined`, an empty string stays an empty string.
 */
export function optionalStr(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > MAX_TEXT_LENGTH
    ? trimmed.slice(0, MAX_TEXT_LENGTH)
    : trimmed;
}

/**
 * Reads an unknown value as a whole number inside `[min, max]`, or
 * `undefined` when it cannot be read as one. A value outside the range is
 * clamped rather than rejected, so `confidence=9` reads as full confidence
 * instead of silently dropping the rating; a fractional value is rounded.
 * Anything that is not a finite number (a word, an empty string, a bare
 * attribute's `null`) yields `undefined`, which every caller renders as
 * "no rating given" rather than as zero.
 */
export function intInRange(
  raw: unknown,
  min: number,
  max: number,
): number | undefined {
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * Whether `raw` reads as a recognized member of `allowed`, returning the
 * member itself or `undefined`. Membership is tested against a list rather
 * than by indexing a lookup object: an object lookup answers for inherited
 * `Object.prototype` keys too, so `level=constructor` would come back as a
 * function and stringify into a class attribute. A list has no such keys.
 */
export function oneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return (allowed as readonly string[]).includes(trimmed)
    ? (trimmed as T)
    : undefined;
}

/**
 * Runs `read` — an extraction that touches an untrusted bound `data`
 * value — and falls back to `fallback()` if any part of it throws. The
 * whole extraction is wrapped rather than each property read, mirroring
 * `@markii/react`'s internal `safeRead`: a value whose reads throw is
 * unreadable as a whole, so a half-collected result would be arbitrary
 * rather than useful. `read` must return only values derived from the
 * bound data (strings, numbers, plain arrays of them), never the hostile
 * object itself; `fallback` must not touch the bound value at all.
 */
export function safeExtract<T>(
  read: () => T,
  fallback: () => T,
): { fields: T; fault?: string } {
  try {
    return { fields: read() };
  } catch (err) {
    return { fields: fallback(), fault: describeFault(err) };
  }
}

/**
 * Best-effort description of something host data threw, for the tooltip
 * channel. Every step is itself guarded: `instanceof`, `.message`, and
 * `String(...)` can all throw when the thrown value is a revoked `Proxy`
 * or an object with hostile traps.
 */
function describeFault(err: unknown): string {
  const generic = 'value store threw while reading this name';
  try {
    if (err instanceof Error && err.message !== '') return err.message;
    const text = String(err);
    return text === '' ? generic : text;
  } catch {
    return generic;
  }
}

/**
 * The tooltip text for a failed binding: the store's own error message
 * when the run failed, otherwise the fault a hostile value produced
 * during extraction. Never returns an empty string, so the result can go
 * straight to `title=` without producing an empty tooltip.
 */
export function failureTitle(
  error: string | undefined,
  fault: string | undefined,
): string | undefined {
  const message = error ?? fault;
  return message !== undefined && message !== '' ? message : undefined;
}

/**
 * The class list for a data-bound component's root element: `base`, plus
 * `--stale`/`--error` modifiers mirroring the reference components' status
 * hooks, so a stylesheet can tint a binding that is not "fresh right now".
 * Class names only — the visible body of the component never changes.
 */
export function stateClassName(
  base: string,
  status: string | undefined,
): string {
  if (status === 'stale') return `${base} ${base}--stale`;
  if (status === 'error') return `${base} ${base}--error`;
  return base;
}

/**
 * Whether a binding is unreadable: the store never produced it ('missing')
 * or the producing script failed ('error'). Both render the component's
 * ordinary quiet empty state.
 */
export function isUnreadable(status: string | undefined): boolean {
  return status === 'missing' || status === 'error';
}

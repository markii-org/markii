/**
 * The scheduled-refresh interval's parsing, validation, and clamp,
 * merged from `apps/vscode/src/refresh-interval.ts` (the input-box
 * parse/validate half) and `apps/obsidian/src/local-settings.ts`'s
 * `refreshIntervalMsFromSeconds`/`MIN_REFRESH_INTERVAL_SECONDS` (the
 * read-side clamp half) — survey finding A7: the constant was duplicated
 * verbatim, with Obsidian's own comment noting it mirrors VS Code's, and
 * the clamp-not-reject policy was duplicated as both prose and behavior.
 *
 * The policy: a positive value under `MIN_REFRESH_INTERVAL_SECONDS` is
 * still ACCEPTED as typed (a host's own settings UI must not silently
 * rewrite what the user entered), but is clamped UP to the minimum only
 * once a view actually schedules a timer against it.
 *
 * Pure and dependency-free: re-exported from `../browser.ts` as well as
 * `../index.ts`.
 */

/** Below this, a positive scheduled-refresh interval is clamped up rather than silently rejected. */
export const MIN_REFRESH_INTERVAL_SECONDS = 5;

/**
 * Parses a user-typed interval into whole seconds, or `undefined` when the
 * input is not a positive integer (empty, non-numeric, zero, negative, or
 * fractional). Whitespace around the input is ignored.
 */
export function parseRefreshIntervalSeconds(input: string): number | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return seconds;
}

/**
 * An error message for input `parseRefreshIntervalSeconds` would reject,
 * or `undefined` when the input is valid. What a host's own interval
 * prompt (an input box, a settings field) shows as its validation
 * message.
 */
export function refreshIntervalValidationMessage(
  input: string,
): string | undefined {
  if (parseRefreshIntervalSeconds(input) === undefined) {
    return 'Enter a whole number of seconds greater than 0.';
  }
  return undefined;
}

/**
 * The scheduled-refresh interval in milliseconds a view should actually
 * run its timer at, or `undefined` when refresh is off (`seconds` is `0`
 * or any non-positive/invalid value). A positive value below
 * `MIN_REFRESH_INTERVAL_SECONDS` is clamped up to it.
 */
export function refreshIntervalMsFromSeconds(
  seconds: number,
): number | undefined {
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return undefined;
  }
  return Math.max(seconds, MIN_REFRESH_INTERVAL_SECONDS) * 1000;
}

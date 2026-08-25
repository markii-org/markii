/**
 * The pure parsing/validation behind the `markii.enableScheduledRefresh`
 * command (an input box that writes `markii.refreshIntervalSeconds`).
 * `vscode`-free and pure so the parsing rule is unit-tested without a real
 * input box; `extension.ts` owns the prompt and the
 * `getConfiguration().update` call.
 *
 * Mirrors `preview-panel.ts`'s own read-side clamp: a positive value under
 * `MIN_REFRESH_INTERVAL_SECONDS` is still accepted here (the command does
 * not silently rewrite what the user typed), but `preview-panel.ts` treats
 * it as `MIN_REFRESH_INTERVAL_SECONDS` when a preview actually schedules a
 * refresh. `extension.ts` mentions this in the command's prompt text.
 */

/** Kept in sync with `preview-panel.ts`'s own constant of the same name. */
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
 * `vscode.InputBoxOptions.validateInput` for the interval prompt: an error
 * message for input `parseRefreshIntervalSeconds` would reject, or
 * `undefined` when the input is valid.
 */
export function refreshIntervalValidationMessage(
  input: string,
): string | undefined {
  if (parseRefreshIntervalSeconds(input) === undefined) {
    return 'Enter a whole number of seconds greater than 0.';
  }
  return undefined;
}

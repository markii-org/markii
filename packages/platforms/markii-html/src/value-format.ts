import { formatValue } from '@markii/stdlib';

/**
 * `stringifyStoredValue` is kept as a thin, unformatted wrapper around
 * `@markii/stdlib`'s `formatValue` (called with no `format`, i.e. `'plain'`)
 * rather than removed outright: it is this engine's existing name for "the
 * :value[...] default coercion", used wherever a caller has no `format=`/
 * `decimals=` attribute to thread through (e.g. a data-bound component's
 * unformatted fields). Both engines' `:value[...]` and every `format=`-aware
 * component (`stat`, `progress`, `table`) call `formatValue` directly so a
 * number, date, or percentage reads identically in both — see
 * `docs/format.md`.
 *
 * Never throws for any stored value, for the same reason `formatValue`
 * itself never throws.
 */
export function stringifyStoredValue(value: unknown): string {
  return formatValue(value);
}

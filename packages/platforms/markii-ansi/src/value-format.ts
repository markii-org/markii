import { formatValue } from '@markii/stdlib';

/**
 * A thin, unformatted wrapper around `@markii/stdlib`'s `formatValue`
 * (called with no `format`, i.e. `'plain'`), mirroring `@markii/html`'s
 * `stringifyStoredValue`: this engine's name for "the `:value[...]`
 * default coercion", used wherever a caller has no `format=`/`decimals=`
 * attribute to thread through. Every engine's `:value[...]` and every
 * `format=`-aware component calls `formatValue` directly instead, so a
 * number, date, or percentage reads identically across all three
 * (docs/format.md).
 *
 * Never throws, for the same reason `formatValue` itself never throws.
 */
export function stringifyStoredValue(value: unknown): string {
  return formatValue(value);
}

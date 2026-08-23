/**
 * Ported from `@markii/react`'s `components/value-directive.tsx`: coerces a
 * resolved store value to display text for `:value[...]`. Kept as its own
 * tiny module because it has no dependency on hast/registry types and is
 * useful in isolation (colocated test).
 */

/**
 * `String(value)` for a value that may be actively hostile — a revoked
 * `Proxy`, an object with a throwing `toString`/`Symbol.toPrimitive`, an
 * `Object.create(null)` with no `toString` at all. Degrades to the empty
 * string rather than throwing.
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
 * `null`/`undefined` render as an empty string. Never throws for any stored
 * value.
 */
export function stringifyStoredValue(value: unknown): string {
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

/**
 * The ONE shared value-formatting primitive for the `format`/`decimals`
 * attributes (docs/format.md, docs/scripting.md's "Where values go"):
 * `:value[...]`, `::stat`, `::progress`, and `::table` all display a stored
 * or attribute value through `formatValue`, so a number, date, or
 * percentage reads identically no matter which component or which engine
 * (`@markii/react`, `@markii/html`) rendered it.
 *
 * Zero dependency beyond the platform's own `Intl` — no third-party
 * date/number library, matching this package's neutral, framework-free
 * posture. Every branch is defensive: a hostile bound value (a throwing
 * getter, a revoked `Proxy`, a `Symbol`, `NaN`, `±Infinity`, a huge number,
 * negative zero) degrades to the plain stringified value rather than
 * throwing, and an unrecognized `format` name behaves exactly like `plain`.
 *
 * Locale is pinned to `'en-US'` rather than left to the host environment:
 * grouping separators, date wording, and the "3 hours ago" phrasing must
 * read the same in a Node test runner, a browser preview, and a
 * statically-exported HTML file, and an unpinned locale would make
 * `@markii/html`'s conformance fixtures depend on the machine running them.
 */
import type { AttributeSchema } from './contracts.js';

/** The closed `format=` vocabulary. Any other string (including a typo or an author's guess) behaves as `'plain'`. */
export type ValueFormat =
  'plain' | 'number' | 'compact' | 'percent' | 'date' | 'relative';

const VALUE_FORMATS: readonly ValueFormat[] = [
  'plain',
  'number',
  'compact',
  'percent',
  'date',
  'relative',
];

/** The one locale every `Intl` call in this module uses, so formatted output is identical across machines and CI runners. */
const LOCALE = 'en-US';

/** `decimals=` is accepted for these three formats only; `date`/`relative`/`plain` ignore it. */
const DECIMAL_AWARE_FORMATS: ReadonlySet<ValueFormat> = new Set([
  'number',
  'compact',
  'percent',
]);

/** The default `maximumFractionDigits` per decimal-aware format when `decimals=` is absent or invalid. */
const DEFAULT_MAX_FRACTION_DIGITS: Record<
  'number' | 'compact' | 'percent',
  number
> = {
  number: 3, // Intl.NumberFormat's own default for a plain decimal
  compact: 1, // "2.3M" / "12.4k"
  percent: 1, // "12.3%"
};

/** `decimals=` is clamped to this closed range; anything else is ignored (falls back to the format's own default). */
const MIN_DECIMALS = 0;
const MAX_DECIMALS = 6;

function normalizeFormat(format: string | undefined): ValueFormat {
  if (format === undefined) return 'plain';
  return (VALUE_FORMATS as readonly string[]).includes(format)
    ? (format as ValueFormat)
    : 'plain';
}

/**
 * Parses `decimals=` to an integer in `[0, 6]`, or `undefined` for anything
 * else: absent, empty, negative, above 6, non-integer (`2.5`), or
 * non-numeric text. An out-of-range or malformed value is ignored rather
 * than clamped or rejected — the format's own default decides instead.
 */
function parseDecimals(decimals: string | undefined): number | undefined {
  if (decimals === undefined) return undefined;
  const trimmed = decimals.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < MIN_DECIMALS || parsed > MAX_DECIMALS) return undefined;
  return parsed;
}

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
 * The `format: 'plain'` behavior, and the fallback every other format uses
 * for input it cannot make sense of (docs/format.md: "non-numeric input
 * under a numeric format renders the plain stringified value, never an
 * error"). Objects/arrays render as JSON; `null`/`undefined` render as the
 * empty string. Never throws for any value.
 */
function plainStringify(value: unknown): string {
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

/**
 * Coerces `value` to a number for a numeric format (`number`/`compact`/
 * `percent`), or `undefined` when it isn't one — a boolean, `null`,
 * `undefined`, an object/array, a `Symbol`, or a non-numeric string all
 * return `undefined` here rather than a guessed number. A `number` typed
 * value (including `NaN`/`±Infinity`) is returned as-is: `Intl.NumberFormat`
 * renders those without throwing (`"NaN"`, `"∞"`), so there is nothing to
 * guard against by rejecting them. Negative zero is normalized to `0`
 * before it ever reaches `Intl`, since a stray `-0` in the middle of a
 * document reads as a bug, not a value worth preserving.
 */
function coerceNumericInput(value: unknown): number | undefined {
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Whether `value` is something a numeric `format` would actually format —
 * a `number` (any value, including `NaN`/`±Infinity`) or a numeric string.
 * `::table`'s "`format`/`decimals` apply to numeric cells only" (docs/
 * format.md) uses this to decide, per cell, whether to route through
 * `formatValue` with the requested format or fall back to plain text.
 */
export function isNumericLike(value: unknown): boolean {
  return coerceNumericInput(value) !== undefined;
}

/**
 * Parses `value` into a `Date` for `date`/`relative`, accepting an ISO 8601
 * string, a numeric string of epoch milliseconds, or a `number` of epoch
 * milliseconds — exactly the two input shapes docs/format.md promises.
 * Returns `undefined` for anything else, or for text/numbers that parse to
 * an invalid date (`NaN`, `±Infinity`, out-of-range milliseconds, garbage
 * text): the `Date` constructor never throws for these, it just produces an
 * "Invalid Date", so the `isNaN` check is what turns that into "not a date"
 * for this module's purposes.
 */
function parseDateInput(value: unknown): Date | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const asEpoch = /^-?\d+$/.test(trimmed) ? Number(trimmed) : undefined;
    const date = new Date(asEpoch ?? trimmed);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

/**
 * `Intl.NumberFormat`'s compact notation renders the thousands magnitude as
 * `"12K"` (uppercase); docs/format.md's example is lowercase (`"12.4k"`),
 * following the common "k for thousand, M/B/T for the rest" convention. The
 * uppercase `K` is the only magnitude suffix `Intl` renders that way for
 * `en-US` (millions/billions/trillions are already `M`/`B`/`T`), so a single
 * trailing-letter replacement is enough — never a broader case-fold, which
 * would also mangle a negative sign or digits.
 */
function lowercaseThousandsSuffix(formatted: string): string {
  return formatted.endsWith('K') ? `${formatted.slice(0, -1)}k` : formatted;
}

/** Buckets a millisecond duration into the coarsest unit `Intl.RelativeTimeFormat` should phrase it in, rounding to the nearest whole unit. */
function relativeParts(diffMs: number): {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
} {
  const seconds = diffMs / 1000;
  if (Math.abs(seconds) < 60)
    return { value: Math.round(seconds), unit: 'second' };
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60)
    return { value: Math.round(minutes), unit: 'minute' };
  const hours = minutes / 60;
  if (Math.abs(hours) < 24) return { value: Math.round(hours), unit: 'hour' };
  const days = hours / 24;
  if (Math.abs(days) < 30) return { value: Math.round(days), unit: 'day' };
  const months = days / 30;
  if (Math.abs(months) < 12)
    return { value: Math.round(months), unit: 'month' };
  const years = days / 365;
  return { value: Math.round(years), unit: 'year' };
}

function formatNumeric(
  format: 'number' | 'compact' | 'percent',
  value: unknown,
  decimals: number | undefined,
): string {
  const num = coerceNumericInput(value);
  if (num === undefined) return plainStringify(value);

  const maxFractionDigits = decimals ?? DEFAULT_MAX_FRACTION_DIGITS[format];
  try {
    if (format === 'number') {
      return new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: maxFractionDigits,
      }).format(num);
    }
    if (format === 'compact') {
      const formatted = new Intl.NumberFormat(LOCALE, {
        notation: 'compact',
        minimumFractionDigits: decimals,
        maximumFractionDigits: maxFractionDigits,
      }).format(num);
      return lowercaseThousandsSuffix(formatted);
    }
    return new Intl.NumberFormat(LOCALE, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: maxFractionDigits,
    }).format(num);
  } catch {
    // `Intl.NumberFormat` does not throw for any finite/NaN/Infinity number
    // with these options, but this is not the place to bet a "never
    // throws" contract on that: any failure here still degrades cleanly.
    return plainStringify(value);
  }
}

function formatDate(value: unknown): string {
  const date = parseDateInput(value);
  if (!date) return plainStringify(value);
  try {
    return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(
      date,
    );
  } catch {
    return plainStringify(value);
  }
}

function formatRelative(value: unknown, now: number): string {
  const date = parseDateInput(value);
  if (!date) return plainStringify(value);
  try {
    const { value: amount, unit } = relativeParts(date.getTime() - now);
    return new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' }).format(
      amount,
      unit,
    );
  } catch {
    return plainStringify(value);
  }
}

/**
 * Formats `value` for display, per the closed `format=` vocabulary
 * (docs/format.md): `plain` (default, and the fallback for an unrecognized
 * name) reproduces exactly what `:value[...]` has always rendered;
 * `number`/`compact`/`percent` render a coerced numeric value (falling back
 * to `plain` for non-numeric input) and accept `decimals` (an integer
 * `0`-`6`, otherwise ignored in favor of the format's own default);
 * `date`/`relative` parse an ISO 8601 string or epoch-millisecond input
 * (number or numeric string) into a local date, `relative` phrasing it
 * against `now` (defaulting to render time, `Date.now()`) rather than
 * carrying a clock read into the render itself — a caller in a script
 * context can pass a fixed `now` to keep a render pure.
 *
 * Never throws, for any `value` (including a hostile object, a throwing
 * getter, a `Symbol`, `NaN`, `±Infinity`, a huge number, or negative zero)
 * and any `format`/`decimals` string.
 */
export function formatValue(
  value: unknown,
  format?: string,
  decimals?: string,
  now: number = Date.now(),
): string {
  const effectiveFormat = normalizeFormat(format);
  if (effectiveFormat === 'plain') return plainStringify(value);

  const parsedDecimals = DECIMAL_AWARE_FORMATS.has(effectiveFormat)
    ? parseDecimals(decimals)
    : undefined;

  switch (effectiveFormat) {
    case 'number':
    case 'compact':
    case 'percent':
      return formatNumeric(effectiveFormat, value, parsedDecimals);
    case 'date':
      return formatDate(value);
    case 'relative':
      return formatRelative(value, now);
    /* istanbul ignore next -- exhaustiveness guard; normalizeFormat never returns anything else here */
    default:
      return plainStringify(value);
  }
}

/**
 * The shared `format` schema, reused by every contract that renders a
 * value through `formatValue` (`::stat`, `::progress`, `::table`). Wording
 * is identical everywhere on purpose: an author who learned `format` on
 * `stat` should not have to re-read it on `table`.
 */
export const FORMAT_ATTRIBUTE: AttributeSchema = {
  type: 'string',
  required: false,
  enum: VALUE_FORMATS,
  description:
    'Formats the displayed value: `plain` (default), `number` (grouped ' +
    'thousands), `compact` (`2.3M`, `12.4k`), `percent` (`0.123` -> ' +
    '`12.3%`), `date` (an ISO 8601 string or epoch milliseconds -> a local ' +
    'date), or `relative` (`3 hours ago`, computed against render time). ' +
    'Non-numeric input under a numeric format, or non-date input under ' +
    '`date`/`relative`, renders the plain value instead of an error; an ' +
    'unrecognized name behaves as `plain`.',
};

/** The shared `decimals` schema, reused alongside `FORMAT_ATTRIBUTE`. */
export const DECIMALS_ATTRIBUTE: AttributeSchema = {
  type: 'string',
  required: false,
  description:
    'Number of decimal places for the `number`, `compact`, and `percent` ' +
    'formats, as an integer `0`-`6`. Ignored for `date`/`relative`/`plain`. ' +
    "An out-of-range or non-integer value is ignored, and the format's own " +
    'default decimal count is used instead.',
};

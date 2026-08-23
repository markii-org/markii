import type { HtmlComponent } from '../registry.js';
import { safeRead } from '../resolve.js';
import { dataStateClassName, failureTitle } from '../failure-presentation.js';

const DEFAULT_MAX = 1;

/** Parses a numeric string defensively: non-numeric, `NaN`, and `±Infinity` all fall back to `fallback`. */
function parseFiniteNumber(
  raw: string | null | undefined,
  fallback: number,
): number {
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A bound `data=` object's recognized fields (§8), read defensively. */
interface ProgressFields {
  value?: number;
  max?: number;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Reads `value`/`max` off a bound `data` value: a bare finite number
 * supplies `value` alone; a plain object may supply either/both fields. MAY
 * THROW for a hostile bound value — guarded at the call site via `safeRead`.
 */
function readProgressFields(data: unknown): ProgressFields {
  if (typeof data === 'number') {
    return { value: Number.isFinite(data) ? data : undefined };
  }
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    return {
      value: coerceNumber(record.value),
      max: coerceNumber(record.max),
    };
  }
  return {};
}

/**
 * `::progress{value=3 max=5 label="tasks"}` — a meter bar. Data binding
 * (§8): a bound numeric `data` supplies `value`; a bound object may supply
 * `value`/`max` — explicit directive attributes always win. Parses
 * defensively: non-numeric/`NaN`/`Infinity` input (from either source) falls
 * back to `0` (value) or the default `max` of `1`; `value` is then clamped
 * to `[0, max]` and `max` is guarded to be positive. Missing/error binding
 * renders a `0%` bar rather than crashing.
 *
 * Markup and class names match `@markii/react`'s `Progress` byte-for-byte.
 */
export const Progress: HtmlComponent = (attributes, _childrenHtml, ctx) => {
  const { data, dataStatus, dataError, dataFailureKind } = ctx;

  const bound = safeRead<ProgressFields>(
    () =>
      dataStatus === 'missing' || dataStatus === 'error'
        ? {}
        : readProgressFields(data),
    () => ({}),
  );
  const fromData = bound.fields;

  const rawMax = parseFiniteNumber(attributes.max, fromData.max ?? DEFAULT_MAX);
  const max = rawMax > 0 ? rawMax : DEFAULT_MAX;

  const rawValue = parseFiniteNumber(attributes.value, fromData.value ?? 0);
  const value = clamp(rawValue, 0, max);

  const percent = clamp((value / max) * 100, 0, 100);
  const label = attributes.label ?? null;

  const className = dataStateClassName(
    'mk-progress',
    dataStatus,
    dataFailureKind,
  );
  const title = failureTitle(dataError ?? bound.fault, dataFailureKind);
  const titleAttr = title ? ` title="${ctx.esc(title)}"` : '';
  const labelHtml = label
    ? `<span class="mk-progress__label">${ctx.esc(label)}</span>`
    : '';

  return (
    `<div class="${className}"${titleAttr} role="progressbar" ` +
    `aria-valuenow="${String(value)}" aria-valuemin="0" aria-valuemax="${String(max)}">` +
    `${labelHtml}` +
    `<div class="mk-progress__track">` +
    `<div class="mk-progress__bar" style="width: ${String(percent)}%"></div>` +
    `</div>` +
    `<span class="mk-progress__percent">${String(Math.round(percent))}%</span>` +
    `</div>`
  );
};

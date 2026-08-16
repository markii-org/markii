import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry.js';

const DEFAULT_MAX = 5;
const MIN_MAX = 1;
const MAX_MAX = 20;

function parseCount(raw: string | null | undefined, fallback: number): number {
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * `::rating{value=3 max=5}` — a leaf directive rendering a row of stars.
 * Both attributes are optional and clamped to sane bounds; malformed input
 * (non-numeric, negative, out of range) degrades gracefully instead of
 * throwing or rendering something nonsensical.
 */
export function Rating({ attributes }: MarkComponentProps): ReactElement {
  const max = clamp(parseCount(attributes.max, DEFAULT_MAX), MIN_MAX, MAX_MAX);
  const value = clamp(parseCount(attributes.value, 0), 0, max);
  const stars = Array.from({ length: max }, (_, index) => index < value);

  return (
    <div
      className="mk-rating"
      role="img"
      aria-label={`rating: ${String(value)} out of ${String(max)}`}
    >
      {stars.map((filled, index) => (
        <span
          key={index}
          className={
            filled
              ? 'mk-rating__star mk-rating__star--filled'
              : 'mk-rating__star'
          }
          aria-hidden="true"
        >
          {filled ? '★' : '☆'}
        </span>
      ))}
    </div>
  );
}

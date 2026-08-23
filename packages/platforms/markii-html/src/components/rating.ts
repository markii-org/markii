import type { HtmlComponent } from '../registry.js';

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
 * degrades gracefully instead of throwing or rendering something
 * nonsensical. Matches `@markii/react`'s `Rating` markup byte-for-byte so
 * one stylesheet covers both renderers.
 */
export const Rating: HtmlComponent = (attributes) => {
  const max = clamp(parseCount(attributes.max, DEFAULT_MAX), MIN_MAX, MAX_MAX);
  const value = clamp(parseCount(attributes.value, 0), 0, max);

  let stars = '';
  for (let index = 0; index < max; index += 1) {
    const filled = index < value;
    const className = filled
      ? 'mk-rating__star mk-rating__star--filled'
      : 'mk-rating__star';
    stars += `<span class="${className}" aria-hidden="true">${filled ? '★' : '☆'}</span>`;
  }

  return (
    `<div class="mk-rating" role="img" aria-label="rating: ${String(value)} out of ${String(max)}">` +
    `${stars}</div>`
  );
};

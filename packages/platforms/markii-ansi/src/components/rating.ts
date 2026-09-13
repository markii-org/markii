import type { AnsiComponent } from '../registry.js';

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
 * degrades gracefully instead of throwing. Terminal form: filled (`★`) and
 * empty (`☆`) stars, one per position up to `max`. Matches
 * `@markii/html`'s `Rating` clamping rules exactly.
 */
export const Rating: AnsiComponent = (attributes) => {
  const max = clamp(parseCount(attributes.max, DEFAULT_MAX), MIN_MAX, MAX_MAX);
  const value = clamp(parseCount(attributes.value, 0), 0, max);

  let stars = '';
  for (let index = 0; index < max; index += 1) {
    stars += index < value ? '★' : '☆';
  }
  return stars;
};

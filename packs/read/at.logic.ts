import { safeHttpUrl, strCapped } from './guard';

const HREF_CAP = 2000;

/**
 * Parses `mm:ss`, `m:ss`, or `hh:mm:ss` into total seconds. Every part
 * must be plain digits (no sign, no decimal); seconds and minutes (when a
 * further unit follows) are range-checked to 0..59. Anything else,
 * including an out-of-range part or a huge digit string that overflows to
 * a non-integer `Number`, yields `undefined`.
 */
export function parseTimestamp(text: string): number | undefined {
  if (!/^\d+(:\d+){1,2}$/.test(text)) return undefined;
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0))
    return undefined;

  // The regex above fixes the part count at two or three, so each default
  // below is unreachable. They are defaults rather than assertions so the
  // guarantee stays checkable.
  if (parts.length === 2) {
    const [minutes = 0, seconds = 0] = parts;
    if (seconds > 59) return undefined;
    return minutes * 60 + seconds;
  }

  const [hours = 0, minutes = 0, seconds = 0] = parts;
  if (minutes > 59 || seconds > 59) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * A page reference: `42`, `p.42`, `p. 42`, `page 42`, and the capitalized
 * spellings of those. The digits are capped at six, since a longer run is
 * an identifier or a typo rather than a page in a book, and the whole
 * string has to match, so `chapter 4` and `42ff` are not page references.
 */
const PAGE_PATTERN = /^(?:(?:p\.?|page)\s*)?(\d{1,6})$/i;

/**
 * Parses a page reference into its page number, or `undefined` when the
 * text is not one. A timestamp is tried first by the caller, so this never
 * sees text with a colon in it. Page zero is rejected along with the
 * unparseable: there is no such page, and a `#page=0` fragment points a
 * viewer at nothing.
 */
export function parsePageRef(text: string): number | undefined {
  const match = PAGE_PATTERN.exec(text);
  if (match === null) return undefined;
  const page = Number(match[1]);
  return Number.isInteger(page) && page >= 1 ? page : undefined;
}

export interface AtModel {
  /** What the chip shows: the text as written, or `--:--` when there is none. */
  display: string;
  /** The safe link target with the position added, or `undefined` for a plain chip. */
  href: string | undefined;
}

/**
 * Reads the chip's text and `href` into what to show and where to link.
 * The text is trimmed by the caller's extraction already; an `href` that is
 * not a safe http(s) URL yields no link. A timestamp appends `t=<seconds>`,
 * a page reference sets the fragment to `#page=<n>`, anything else links
 * unannotated.
 */
export function resolveAt(
  text: string,
  attributes: Record<string, unknown>,
): AtModel {
  const display = text !== '' ? text : '--:--';
  const seconds = parseTimestamp(text);
  const page = seconds === undefined ? parsePageRef(text) : undefined;

  const hrefRaw = strCapped(attributes.href, '', HREF_CAP);
  const safeUrl = hrefRaw !== '' ? safeHttpUrl(hrefRaw) : undefined;
  if (safeUrl === undefined) return { display, href: undefined };

  if (seconds !== undefined) {
    safeUrl.searchParams.set('t', String(seconds));
  } else if (page !== undefined) {
    // Assigning `hash` replaces whatever fragment the href already had,
    // which is what we want: two page anchors on one URL address nothing.
    safeUrl.hash = `page=${String(page)}`;
  }
  return { display, href: safeUrl.toString() };
}

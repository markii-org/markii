import {
  clamp,
  failureTitle,
  finiteOrUndefined,
  isUnreadable,
  safeExtract,
  safeHttpUrl,
  strCapped,
} from './guard';

/**
 * Everything `read_source` decides before it draws anything. The React view
 * (`source.tsx`) and the terminal view (`source.ansi.tsx`) both call
 * `resolveSource` and only differ in how they present the result.
 */

const KNOWN_TYPES = [
  'book',
  'article',
  'paper',
  'podcast',
  'video',
  'course',
] as const;
type KnownType = (typeof KNOWN_TYPES)[number];

const TYPE_LABEL: Record<KnownType, string> = {
  book: 'Book',
  article: 'Article',
  paper: 'Paper',
  podcast: 'Podcast',
  video: 'Video',
  course: 'Course',
};

const KNOWN_STATUSES = ['queued', 'reading', 'done'] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

const STATUS_LABEL: Record<KnownStatus, string> = {
  queued: 'Queued',
  reading: 'Reading',
  done: 'Done',
};

function isKnownType(value: string): value is KnownType {
  return (KNOWN_TYPES as readonly string[]).includes(value);
}

function isKnownStatus(value: string): value is KnownStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(value);
}

/**
 * The largest page count this component treats as a real one. A page
 * number past a million is not a book, it is a typo or a hostile value,
 * and it would otherwise reach the progress tooltip as written.
 */
const MAX_PAGES = 1_000_000;

/**
 * Reads an attribute as a page count: a whole number from zero to
 * `MAX_PAGES`, written as a number or as a numeric string. A fraction, a
 * negative, a word, a bare attribute, or an absurd count all yield
 * `undefined`, which means "no page count was written" rather than an
 * error.
 */
function pageCount(raw: unknown): number | undefined {
  const value = finiteOrUndefined(raw);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > MAX_PAGES)
    return undefined;
  return value;
}

/**
 * Turns the `pages-read`/`pages` pair into a percentage and the tooltip
 * that explains it, or `undefined` when the pair cannot be used. Both
 * counts have to be there, and `pages` has to be greater than zero:
 * `pages=0` is a source whose length was never recorded, not a source
 * that is zero percent read, so it yields nothing rather than dividing by
 * zero.
 */
function pagesProgress(
  read: number | undefined,
  total: number | undefined,
): { percent: number; title: string } | undefined {
  if (read === undefined || total === undefined || total <= 0) return undefined;
  return {
    percent: clamp(Math.round((read / total) * 100), 0, 100),
    title: `${String(read)} of ${String(total)} pages`,
  };
}

/**
 * Reads a progress value off a bound value: a bare finite number, or a
 * plain object's finite `.progress` or `.value` field (`.progress` wins
 * when both are present). Anything else yields `undefined`.
 */
function extractProgress(data: unknown): number | undefined {
  if (typeof data === 'number') return Number.isFinite(data) ? data : undefined;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const progress = record.progress;
    if (typeof progress === 'number' && Number.isFinite(progress))
      return progress;
    const value = record.value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export interface SourceInput {
  attributes: Record<string, unknown>;
  data: unknown;
  dataStatus: string | undefined;
  dataError: string | undefined;
}

export interface SourceModel {
  /** The written title, or `''`. */
  rawTitle: string;
  /** The title to show: the written one, or the "Untitled source" placeholder. */
  displayTitle: string;
  author: string;
  year: string;
  /** "Author, 2019", either part alone, or `''`. */
  byline: string;
  typeLabel: string;
  /** The known type, or `'other'` for any other written value. */
  typeModifier: string;
  status: KnownStatus | undefined;
  statusLabel: string | undefined;
  /** Percent read, clamped to 0..100, or `undefined` when no source gave one. */
  progress: number | undefined;
  /** "120 of 340 pages" when the pages pair produced the progress. */
  pagesTitle: string | undefined;
  /** A safe http(s) URL, or `undefined`. */
  url: URL | undefined;
  /** The reason a binding failed or a hostile value threw, for a tooltip. */
  failureText: string | undefined;
}

export function resolveSource(input: SourceInput): SourceModel {
  const { attributes, data, dataStatus, dataError } = input;
  const rawTitle = strCapped(attributes.title, '', 200);
  const author = strCapped(attributes.author, '', 200);
  const year = strCapped(attributes.year, '', 50);
  const rawUrl = strCapped(attributes.url, '', 2000);
  const rawType = strCapped(attributes.type, 'book', 24) || 'book';
  const rawStatus = strCapped(attributes.status, '', 20);

  const bound = safeExtract<number | undefined>(
    () => (isUnreadable(dataStatus) ? undefined : extractProgress(data)),
    () => undefined,
  );
  // A written `progress` is checked first, so the pages pair is only ever
  // consulted when there is no percentage written by hand to defer to.
  const attrProgress = finiteOrUndefined(attributes.progress);
  const fromPages =
    attrProgress === undefined
      ? pagesProgress(
          pageCount(attributes['pages-read']),
          pageCount(attributes.pages),
        )
      : undefined;
  const rawProgress = attrProgress ?? fromPages?.percent ?? bound.fields;

  const status = isKnownStatus(rawStatus) ? rawStatus : undefined;

  return {
    rawTitle,
    displayTitle: rawTitle !== '' ? rawTitle : 'Untitled source',
    author,
    year,
    byline: [author, year].filter((part) => part !== '').join(', '),
    typeLabel: isKnownType(rawType) ? TYPE_LABEL[rawType] : rawType,
    typeModifier: isKnownType(rawType) ? rawType : 'other',
    status,
    statusLabel: status !== undefined ? STATUS_LABEL[status] : undefined,
    progress:
      rawProgress !== undefined ? clamp(rawProgress, 0, 100) : undefined,
    pagesTitle: fromPages?.title,
    url: rawUrl !== '' ? safeHttpUrl(rawUrl) : undefined,
    failureText: failureTitle(dataError, bound.fault),
  };
}

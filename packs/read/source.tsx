import type { ReactElement, ReactNode } from 'react';
import type { MarkComponentProps } from '@markii/react';
import {
  clamp,
  failureTitle,
  finiteOrUndefined,
  isUnreadable,
  safeExtract,
  safeHttpUrl,
  stateClassName,
  strCapped,
} from './guard';
import './source.css';

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
type KnownStatus = (typeof KNOWN_STATUSES)[number];

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

/**
 * `::read_source{title="..." author="..." year="2019" type=book status=reading progress=40}`
 * a compact citation card. `type` and `status` are closed sets; an
 * unrecognized `type` still shows as a neutral badge carrying the raw
 * text (capped), while an unrecognized `status` is simply omitted rather
 * than guessed at.
 *
 * There are three ways to say how far along a source is, tried in this
 * order: a written `progress`, then the `pages-read`/`pages` pair, then a
 * `data=` binding. The pair is what a reader actually has to hand, so
 * writing both turns into a percentage (rounded, clamped to 0..100) and
 * the bar carries a "120 of 340 pages" tooltip. A junk page count is
 * ignored and the binding takes over, the same as if it had not been
 * written. The bound shape is a bare number or an object with a finite
 * `.progress` or `.value` field. A source with no usable `title` still
 * renders, as a quiet "Untitled source" placeholder, rather than
 * vanishing or crashing.
 */
export function Source({
  attributes,
  data,
  dataStatus,
  dataError,
}: MarkComponentProps): ReactElement {
  const rawTitle = strCapped(attributes.title, '', 200);
  const author = strCapped(attributes.author, '', 200);
  const year = strCapped(attributes.year, '', 50);
  const url = strCapped(attributes.url, '', 2000);
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
  const progress =
    rawProgress !== undefined ? clamp(rawProgress, 0, 100) : undefined;
  const title = failureTitle(dataError, bound.fault);

  const safeUrl = url !== '' ? safeHttpUrl(url) : undefined;
  const displayTitle = rawTitle !== '' ? rawTitle : 'Untitled source';
  const titleNode: ReactNode =
    rawTitle !== '' && safeUrl !== undefined ? (
      <a className="mk-read_source__title-link" href={safeUrl.toString()}>
        {displayTitle}
      </a>
    ) : (
      displayTitle
    );

  const bylineParts = [author, year].filter((part) => part !== '');
  const byline = bylineParts.join(', ');

  const status = isKnownStatus(rawStatus) ? rawStatus : undefined;
  const typeLabel = isKnownType(rawType) ? TYPE_LABEL[rawType] : rawType;
  const typeModifier = isKnownType(rawType) ? rawType : 'other';

  return (
    <div className={stateClassName('mk-read_source', dataStatus)} title={title}>
      <div className="mk-read_source__head">
        <span
          className={`mk-read_source__badge mk-read_source__badge--${typeModifier}`}
        >
          {typeLabel}
        </span>
        <span
          className={
            rawTitle !== ''
              ? 'mk-read_source__title'
              : 'mk-read_source__title mk-read_source__title--placeholder'
          }
        >
          {titleNode}
        </span>
      </div>
      {byline !== '' && <div className="mk-read_source__byline">{byline}</div>}
      {status !== undefined && (
        <div className="mk-read_source__status">
          <span
            className={`mk-read_source__status-dot mk-read_source__status-dot--${status}`}
            aria-hidden="true"
          />
          {STATUS_LABEL[status]}
        </div>
      )}
      {progress !== undefined && (
        <div
          className="mk-read_source__progress-track"
          title={fromPages?.title}
        >
          <div
            className="mk-read_source__progress-fill"
            style={{ width: `${String(progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}

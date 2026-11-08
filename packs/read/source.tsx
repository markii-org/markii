import type { ReactElement, ReactNode } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { stateClassName } from './guard';
import { resolveSource } from './source.logic';
import './source.css';

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
  const model = resolveSource({ attributes, data, dataStatus, dataError });
  const { rawTitle, displayTitle, byline, status, progress, url } = model;

  const titleNode: ReactNode =
    rawTitle !== '' && url !== undefined ? (
      <a className="mk-read_source__title-link" href={url.toString()}>
        {displayTitle}
      </a>
    ) : (
      displayTitle
    );

  return (
    <div
      className={stateClassName('mk-read_source', dataStatus)}
      title={model.failureText}
    >
      <div className="mk-read_source__head">
        <span
          className={`mk-read_source__badge mk-read_source__badge--${model.typeModifier}`}
        >
          {model.typeLabel}
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
          {model.statusLabel}
        </div>
      )}
      {progress !== undefined && (
        <div
          className="mk-read_source__progress-track"
          title={model.pagesTitle}
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

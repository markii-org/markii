import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { oneOf, optionalStr, str } from './guard';
import './q.css';

const LEVELS = ['easy', 'medium', 'hard'] as const;

/**
 * `:::prep_q{q="..." level=hard topic="graphs"}` ... `:::`, one question
 * card in a set of interview notes.
 *
 * The point of the card is self-testing, so the body (the answer) is put
 * behind a native `<details>` labeled "Answer": the question and its tags
 * are readable at a glance, and the answer only appears once the reader
 * asks for it. `<details>` is used rather than a script-driven toggle so
 * the reveal works in every host, in a printed page, and under keyboard
 * control without this pack owning any state.
 *
 * With no `q` attribute there is nothing to test yourself against, so the
 * reveal would hide the only content the card has. In that case the body
 * renders directly, tags and all, with no collapsed region. That is the
 * quiet degradation, not an error: a card mid-edit still reads correctly.
 *
 * `level` is a closed set (`easy`, `medium`, `hard`), each with its own
 * tint. An unrecognized value still shows as a tag carrying the written
 * text, styled neutral, so a typo relabels nothing.
 */
export function PrepQuestion({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const question = str(attributes?.q);
  const topic = str(attributes?.topic);
  const rawLevel = optionalStr(attributes?.level);
  const level = oneOf(rawLevel, LEVELS);
  const levelText =
    level ?? (rawLevel !== undefined && rawLevel !== '' ? rawLevel : '');
  const levelModifier = level ?? 'other';

  const hasTags = levelText !== '' || topic !== '';
  const hasHead = question !== '' || hasTags;

  const tags = hasTags ? (
    <span className="mk-prep_q__tags">
      {levelText !== '' && (
        <span className={`mk-prep_q__level mk-prep_q__level--${levelModifier}`}>
          {levelText}
        </span>
      )}
      {topic !== '' && <span className="mk-prep_q__topic">{topic}</span>}
    </span>
  ) : null;

  return (
    <div className="mk-prep_q">
      {hasHead && (
        <div className="mk-prep_q__head">
          {question !== '' && (
            <span className="mk-prep_q__question">{question}</span>
          )}
          {tags}
        </div>
      )}
      {question !== '' ? (
        <details className="mk-prep_q__reveal">
          <summary className="mk-prep_q__summary">Answer</summary>
          <div className="mk-prep_q__body">{children}</div>
        </details>
      ) : (
        <div className="mk-prep_q__body mk-prep_q__body--open">{children}</div>
      )}
    </div>
  );
}

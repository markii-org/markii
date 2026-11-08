import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { stateClassName } from './guard';
import { resolveQuiz } from './quiz.logic';
import './quiz.css';

/**
 * `::prep_quiz{data=quiz}` — the questions a note already contains, drawn
 * as one list you can work through, each answer hidden until you ask for
 * it.
 *
 * The bound value is `{questions: [{q, topic, level, answer}]}`, which is
 * what a script gets by walking the note's own `:::prep_q` blocks:
 * `doc.directives{name = "prep_q"}` hands back each block's attributes and
 * its plain inner text, so the quiz is built from the cards rather than
 * typed a second time.
 *
 * Each answer sits behind a native `<details>`, the same choice `prep_q`
 * makes and for the same reasons: the reveal works in every host, in a
 * printed page, and under keyboard control, and this pack owns no state.
 *
 * With no binding yet (a note that has not been run) the component shows a
 * quiet line saying so, never an error: the note is simply not run yet,
 * and that is a normal state for a page to be in.
 */
export function PrepQuiz({
  data,
  dataStatus,
  dataError,
}: MarkComponentProps): ReactElement {
  const { items, failureText } = resolveQuiz({ data, dataStatus, dataError });

  return (
    <div
      className={stateClassName('mk-prep_quiz', dataStatus)}
      title={failureText}
    >
      {items.length === 0 ? (
        <p className="mk-prep_quiz__empty">No questions collected yet</p>
      ) : (
        <ol className="mk-prep_quiz__list">
          {items.map((item, index) => (
            <li className="mk-prep_quiz__item" key={index}>
              <div className="mk-prep_quiz__head">
                <span className="mk-prep_quiz__question">
                  {item.q !== '' ? item.q : 'Untitled question'}
                </span>
                {(item.level.text !== '' || item.topic !== '') && (
                  <span className="mk-prep_quiz__tags">
                    {item.level.text !== '' && (
                      <span
                        className={`mk-prep_quiz__level mk-prep_quiz__level--${item.level.modifier}`}
                      >
                        {item.level.text}
                      </span>
                    )}
                    {item.topic !== '' && (
                      <span className="mk-prep_quiz__topic">{item.topic}</span>
                    )}
                  </span>
                )}
              </div>
              {item.answer !== '' && (
                <details className="mk-prep_quiz__reveal">
                  <summary className="mk-prep_quiz__summary">Answer</summary>
                  <p className="mk-prep_quiz__answer">{item.answer}</p>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

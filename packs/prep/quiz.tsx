import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import {
  failureTitle,
  isUnreadable,
  oneOf,
  optionalStr,
  safeExtract,
  stateClassName,
  str,
} from './guard';
import './quiz.css';

const LEVELS = ['easy', 'medium', 'hard'] as const;

const MAX_QUESTIONS = 200;

interface QuizItem {
  q: string;
  topic: string;
  levelText: string;
  levelModifier: string;
  answer: string;
}

/**
 * Reads `{questions: [{q, topic, level, answer}]}` off a bound value. An
 * entry that is not a plain object is skipped; an entry missing a field
 * degrades to an empty one rather than being dropped, because a question
 * with no topic is still a question worth revising.
 */
function extractQuiz(data: unknown): QuizItem[] {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }
  const record = data as Record<string, unknown>;
  const raw = Array.isArray(record.questions) ? record.questions : [];

  const items: QuizItem[] = [];
  for (const entry of raw) {
    if (items.length >= MAX_QUESTIONS) break;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const rawLevel = optionalStr(row.level);
    const level = oneOf(rawLevel, LEVELS);
    items.push({
      q: str(row.q),
      topic: str(row.topic),
      levelText:
        level ?? (rawLevel !== undefined && rawLevel !== '' ? rawLevel : ''),
      levelModifier: level ?? 'other',
      answer: str(row.answer),
    });
  }
  return items;
}

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
  const bound = safeExtract<QuizItem[]>(
    () => (isUnreadable(dataStatus) ? [] : extractQuiz(data)),
    () => [],
  );
  const items = bound.fields;

  return (
    <div
      className={stateClassName('mk-prep_quiz', dataStatus)}
      title={failureTitle(dataError, bound.fault)}
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
                {(item.levelText !== '' || item.topic !== '') && (
                  <span className="mk-prep_quiz__tags">
                    {item.levelText !== '' && (
                      <span
                        className={`mk-prep_quiz__level mk-prep_quiz__level--${item.levelModifier}`}
                      >
                        {item.levelText}
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

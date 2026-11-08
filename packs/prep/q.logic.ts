import { oneOf, optionalStr, str } from './guard';

const LEVELS = ['easy', 'medium', 'hard'] as const;

export interface LevelTag {
  /** The text to show: the known level, or the written value. `''` for none. */
  text: string;
  /** The known level, or `'other'` for any other written value. */
  modifier: string;
}

/**
 * `level` is a closed set (`easy`, `medium`, `hard`), each with its own
 * tint. An unrecognized value still shows as a tag carrying the written
 * text, styled neutral, so a typo relabels nothing.
 */
export function resolveLevel(raw: unknown): LevelTag {
  const written = optionalStr(raw);
  const level = oneOf(written, LEVELS);
  return {
    text: level ?? (written !== undefined && written !== '' ? written : ''),
    modifier: level ?? 'other',
  };
}

export interface QuestionModel {
  question: string;
  topic: string;
  level: LevelTag;
  hasTags: boolean;
  hasHead: boolean;
}

/** What a `prep_q` card is made of, shared by the React and terminal views. */
export function resolveQuestion(
  attributes: Record<string, unknown> | undefined,
): QuestionModel {
  const question = str(attributes?.q);
  const topic = str(attributes?.topic);
  const level = resolveLevel(attributes?.level);
  const hasTags = level.text !== '' || topic !== '';
  return {
    question,
    topic,
    level,
    hasTags,
    hasHead: question !== '' || hasTags,
  };
}

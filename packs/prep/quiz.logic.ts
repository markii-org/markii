import { failureTitle, isUnreadable, safeExtract, str } from './guard';
import { resolveLevel, type LevelTag } from './q.logic';

const MAX_QUESTIONS = 200;

export interface QuizItem {
  q: string;
  topic: string;
  level: LevelTag;
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
    items.push({
      q: str(row.q),
      topic: str(row.topic),
      level: resolveLevel(row.level),
      answer: str(row.answer),
    });
  }
  return items;
}

export interface QuizModel {
  items: QuizItem[];
  failureText: string | undefined;
}

export function resolveQuiz(input: {
  data: unknown;
  dataStatus: string | undefined;
  dataError: string | undefined;
}): QuizModel {
  const bound = safeExtract<QuizItem[]>(
    () => (isUnreadable(input.dataStatus) ? [] : extractQuiz(input.data)),
    () => [],
  );
  return {
    items: bound.fields,
    failureText: failureTitle(input.dataError, bound.fault),
  };
}

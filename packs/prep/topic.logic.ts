import { intInRange, str } from './guard';

/** How many dots a confidence rating is drawn with. */
export const CONFIDENCE_SCALE = 5;

export interface TopicModel {
  /** The `name` attribute, or `''`. */
  name: string;
  /** A 1 to 5 rating, clamped; `undefined` for "no rating given". */
  confidence: number | undefined;
}

/**
 * `confidence` runs from 1 to 5 and is clamped into that range, so a
 * stray `confidence=9` reads as full confidence instead of vanishing. A
 * value that is not a number at all omits the dots entirely: "no rating
 * yet" and "rated zero" are different things.
 */
export function resolveTopic(
  attributes: Record<string, unknown> | undefined,
): TopicModel {
  return {
    name: str(attributes?.name),
    confidence: intInRange(attributes?.confidence, 1, CONFIDENCE_SCALE),
  };
}

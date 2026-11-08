const KINDS = ['insight', 'question', 'disagree', 'todo'] as const;
export type MarkKind = (typeof KINDS)[number] | 'neutral';

/**
 * The modifier for `kind`, or `'neutral'` for anything unrecognized.
 * Membership is tested against a list rather than by indexing a lookup
 * object: an object lookup answers for inherited `Object.prototype` keys
 * too, so `kind=constructor` would return a function and stringify into
 * the class attribute. A list has no such keys.
 */
export function kindModifier(raw: string): MarkKind {
  return (KINDS as readonly string[]).includes(raw)
    ? (raw as MarkKind)
    : 'neutral';
}

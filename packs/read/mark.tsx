import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { strCapped } from './guard';
import './mark.css';

const KINDS = ['insight', 'question', 'disagree', 'todo'] as const;

/**
 * The modifier for `kind`, or `'neutral'` for anything unrecognized.
 * Membership is tested against a list rather than by indexing a lookup
 * object: an object lookup answers for inherited `Object.prototype` keys
 * too, so `kind=constructor` would return a function and stringify into
 * the class attribute. A list has no such keys.
 */
function kindModifier(raw: string): string {
  return (KINDS as readonly string[]).includes(raw) ? raw : 'neutral';
}

/**
 * `:read_mark[worth remembering]{kind=insight}`, a highlighter-style
 * inline marker: `<mark>` with its default background replaced by a tint
 * of the theme hue for `kind`. `insight` maps to `--mk-info`, `question`
 * to `--mk-warning`, `disagree` to `--mk-danger`, `todo` to `--mk-success`.
 * A missing or unrecognized `kind` falls back to a neutral tint mixed from
 * `--mk-faint`, never guessed at and never left unstyled.
 */
export function Mark({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const kind = kindModifier(strCapped(attributes.kind, '', 20));

  return (
    <mark className={`mk-read_mark mk-read_mark--${kind}`}>{children}</mark>
  );
}

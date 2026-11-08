import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { strCapped } from './guard';
import { kindModifier } from './mark.logic';
import './mark.css';

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

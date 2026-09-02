import { Children, type ReactElement, type ReactNode } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { intInRange, str } from './guard';
import './topic.css';

/** How many dots a confidence rating is drawn with. */
const SCALE = 5;

/**
 * Whether `node` carries anything worth showing: a non-blank string, or
 * any element at all. Used to decide whether the directive was written
 * with bracket content (`::prep_topic[Graphs]`) or not
 * (`::prep_topic{name="Graphs"}`), since a leaf directive with no
 * brackets arrives with an empty child list rather than with `undefined`.
 * Never throws: a hostile child list is treated as "no content", which
 * falls back to the `name` attribute.
 */
function hasContent(node: ReactNode): boolean {
  try {
    let found = false;
    Children.forEach(node, (child) => {
      if (found) return;
      if (child === null || child === undefined || typeof child === 'boolean')
        return;
      if (typeof child === 'string') {
        if (child.trim() !== '') found = true;
        return;
      }
      found = true;
    });
    return found;
  } catch {
    return false;
  }
}

/**
 * `::prep_topic[Graph traversal]{confidence=3}`, a topic header row for a
 * study sheet: the topic on the left, a confidence rating on the right,
 * drawn as filled and empty dots.
 *
 * The label can be written either way. Bracket content wins when it is
 * there, since it is the closest thing to the text; otherwise the `name`
 * attribute is used, and with neither the row still renders as a quiet
 * "Untitled topic" placeholder rather than collapsing to an empty rule.
 *
 * `confidence` runs from 1 to 5 and is clamped into that range, so a
 * stray `confidence=9` reads as full confidence instead of vanishing.
 * A value that is not a number at all (a word, a bare attribute) omits
 * the dots entirely: "no rating yet" and "rated zero" are different
 * things, and guessing between them would be a quiet lie.
 */
export function PrepTopic({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const name = str(attributes?.name);
  const written = hasContent(children);
  const confidence = intInRange(attributes?.confidence, 1, SCALE);

  const label: ReactNode = written
    ? children
    : name !== ''
      ? name
      : 'Untitled topic';
  const labelClass =
    written || name !== ''
      ? 'mk-prep_topic__label'
      : 'mk-prep_topic__label mk-prep_topic__label--placeholder';

  const dots = [];
  for (let i = 1; i <= SCALE; i++) {
    const filled = confidence !== undefined && i <= confidence;
    dots.push(
      <span
        key={i}
        className={
          filled
            ? 'mk-prep_topic__dot mk-prep_topic__dot--filled'
            : 'mk-prep_topic__dot'
        }
      />,
    );
  }

  return (
    <div className="mk-prep_topic">
      <span className={labelClass}>{label}</span>
      {confidence !== undefined && (
        <span
          className="mk-prep_topic__dots"
          role="img"
          aria-label={`confidence ${String(confidence)} of ${String(SCALE)}`}
        >
          {dots}
        </span>
      )}
    </div>
  );
}

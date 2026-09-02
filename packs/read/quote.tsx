import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { strCapped } from './guard';
import './quote.css';

const ATTR_CAP = 300;

/**
 * `:::read_quote{page="152" source="Gödel, Escher, Bach" note="..."}` ...
 * `:::`, a cited passage, distinguished from a plain blockquote by a
 * right-aligned citation line built from whichever of `source`, `page`,
 * `loc`, and `at` are present (`page` renders as "p. 152", `loc` as
 * "loc. 240", `at` as given). With none of those four attributes set, the
 * citation line is omitted entirely rather than left as an empty rule. A
 * `note` renders as a muted commentary line below the citation. `children`
 * is the directive's inner markdown, already rendered, and is the quoted
 * passage itself.
 */
export function Quote({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const page = strCapped(attributes.page, '', ATTR_CAP);
  const loc = strCapped(attributes.loc, '', ATTR_CAP);
  const at = strCapped(attributes.at, '', ATTR_CAP);
  const source = strCapped(attributes.source, '', ATTR_CAP);
  const note = strCapped(attributes.note, '', ATTR_CAP);

  const citationParts = [
    source,
    page !== '' ? `p. ${page}` : '',
    loc !== '' ? `loc. ${loc}` : '',
    at,
  ].filter((part) => part !== '');
  const citation = citationParts.join(', ');

  return (
    <figure className="mk-read_quote">
      <blockquote className="mk-read_quote__passage">{children}</blockquote>
      {citation !== '' && (
        <figcaption className="mk-read_quote__citation">{citation}</figcaption>
      )}
      {note !== '' && <div className="mk-read_quote__note">{note}</div>}
    </figure>
  );
}

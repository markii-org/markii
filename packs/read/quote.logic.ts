import { strCapped } from './guard';

const ATTR_CAP = 300;

export interface QuoteModel {
  /** "Source, p. 152, loc. 240, 12:34" from whichever parts are set, or `''`. */
  citation: string;
  /** The commentary line, or `''`. */
  note: string;
}

/** The citation and note of a `read_quote`, shared by the React and terminal views. */
export function resolveQuote(attributes: Record<string, unknown>): QuoteModel {
  const page = strCapped(attributes.page, '', ATTR_CAP);
  const loc = strCapped(attributes.loc, '', ATTR_CAP);
  const at = strCapped(attributes.at, '', ATTR_CAP);
  const source = strCapped(attributes.source, '', ATTR_CAP);
  const note = strCapped(attributes.note, '', ATTR_CAP);

  const citation = [
    source,
    page !== '' ? `p. ${page}` : '',
    loc !== '' ? `loc. ${loc}` : '',
    at,
  ]
    .filter((part) => part !== '')
    .join(', ');
  return { citation, note };
}

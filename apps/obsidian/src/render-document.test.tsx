import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderDocument } from './render-document.js';

const SAMPLE = `# Hello Markii

:::callout{type=info}
A known component renders normally.
:::

:::totally-unmade-up{type=fancy}
An unknown directive falls back cleanly.
:::
`;

describe('renderDocument', () => {
  it('renders known directives via the standard registry', () => {
    const html = renderToStaticMarkup(renderDocument(SAMPLE));

    expect(html).toContain('Hello Markii');
    expect(html).toContain('mk-callout');
    expect(html).toContain('A known component renders normally.');
  });

  it('falls back cleanly for an unknown directive (architecture rule 3)', () => {
    const html = renderToStaticMarkup(renderDocument(SAMPLE));

    expect(html).toContain('unknown component');
    expect(html).toContain('totally-unmade-up');
    expect(html).toContain('An unknown directive falls back cleanly.');
  });
});

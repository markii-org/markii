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

  it('forwards resolveImageSrc through to renderMark', () => {
    const html = renderToStaticMarkup(
      renderDocument('![a cat](cat.png)', undefined, undefined, (src) =>
        src === 'cat.png' ? 'app://local/vault/cat.png' : undefined,
      ),
    );
    expect(html).toContain('src="app://local/vault/cat.png"');
  });
});

describe('renderDocument — render diagnostics', () => {
  it('reports a known attribute given a value outside its enum', () => {
    const events: string[] = [];
    renderToStaticMarkup(
      renderDocument(
        ':::card{text="Hey"}\nbody\n:::\n',
        undefined,
        undefined,
        undefined,
        (event) => events.push(`${event.kind} ${event.attribute ?? ''}`),
      ),
    );
    expect(events).toEqual(['invalid-attribute-value text']);
  });

  it('stays silent for an attribute name nothing declares', () => {
    const events: unknown[] = [];
    renderToStaticMarkup(
      renderDocument(
        ':::card{madeUpAttribute=1}\nbody\n:::\n',
        undefined,
        undefined,
        undefined,
        (event) => events.push(event),
      ),
    );
    expect(events).toEqual([]);
  });
});

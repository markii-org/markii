import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render.js';
import { defaultRegistry } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC_CSS = readFileSync(path.join(here, '..', 'doc.css'), 'utf8');

/**
 * Verifies docs/format.md's `:::callout{type=info text=center}` example
 * (a shared text-align preset `row`/`cell`/`card`/`callout` all take)
 * actually centers the callout's text, end to end: the class the component
 * emits, and the CSS rule it depends on.
 *
 * `text-align` is an INHERITED CSS property, and `mk-text-center` lands on
 * the callout's own root element (not a descendant), so nothing else needs
 * to repeat it — `.mk-callout__header`/`.mk-callout__body` (and further,
 * any paragraph inside the body) pick it up through ordinary inheritance,
 * exactly like any other `text-align` on an ancestor. `.mk-callout__body`
 * is `display: flex; flex-direction: column`, which additionally stretches
 * each body child to the full body width (the default cross-axis
 * `align-items: stretch`) — the reason `text=center` visibly moves body
 * text rather than centering a box already exactly as wide as its content.
 */
describe('callout text= (docs/format.md)', () => {
  it('applies mk-text-center to the callout root for text=center', () => {
    const { container } = render(
      renderMark(
        ':::callout{type=info text=center}\nCentered body text.\n:::',
        defaultRegistry,
      ),
    );
    const callout = container.querySelector('.mk-callout');
    expect(callout).toHaveClass('mk-callout--info');
    expect(callout).toHaveClass('mk-text-center');
  });

  it('doc.css centers .mk-text-center and sets no text-align inside .mk-callout that would override it', () => {
    expect(DOC_CSS).toMatch(/\.mk-text-center\s*{\s*text-align:\s*center;/);

    // Isolate every rule block whose selector mentions `.mk-callout`, and
    // confirm none of them declares its own `text-align` — if one did, it
    // would win over the inherited `text-align: center` for anything
    // inside it, defeating the preset silently.
    const calloutBlocks = Array.from(
      DOC_CSS.matchAll(/([^{}]*\.mk-callout[^{}]*)\{([^}]*)\}/g),
    );
    expect(calloutBlocks.length).toBeGreaterThan(0);
    for (const [, selector, body] of calloutBlocks) {
      expect(body ?? '', `selector: ${selector ?? ''}`).not.toMatch(
        /text-align\s*:/,
      );
    }
  });
});

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { INTERACTIVE_ATTRIBUTE } from '@markii/stdlib';
import { renderMark } from '../render.js';
import { defaultRegistry } from './index.js';

/**
 * Executable coverage for #53's host contract (docs/integration.md): every
 * element the standard set renders that is a real `<button>`, carries
 * `role="tab"`/`role="button"`, or is a `<summary>`, must also carry
 * `@markii/stdlib`'s `INTERACTIVE_ATTRIBUTE`. This is what lets an editor
 * host tell click-to-act from click-to-edit without maintaining its own
 * tag/role allowlist.
 *
 * A single note exercises every stdlib component known to emit one of
 * those elements today (`tabs`, `details`, a script marker) — see this
 * file's own scan below for the closed list this test itself is checked
 * against, so a future component that adds a `<button>`/`<summary>`/
 * `role="tab"`/`role="button"` without the marker fails this suite instead
 * of silently joining the allowlist gap.
 */
const SOURCE = `
::::tabs
:::tab{label="A"}
one
:::
:::tab{label="B"}
two
:::
::::

:::details{title="More"}
hidden
:::

\`\`\`lua {name=stars}
return 1
\`\`\`
`;

const INTERACTIVE_SELECTOR = [
  'button',
  'summary',
  '[role="tab"]',
  '[role="button"]',
].join(', ');

describe('interactive marker (#53)', () => {
  it('every button/summary/role=tab/role=button element carries the marker', () => {
    const { container } = render(renderMark(SOURCE, defaultRegistry));
    const candidates = container.querySelectorAll(INTERACTIVE_SELECTOR);

    // Sanity: the fixture actually exercises the elements under test.
    expect(candidates.length).toBeGreaterThan(0);

    const missing: string[] = [];
    candidates.forEach((el) => {
      if (!el.hasAttribute(INTERACTIVE_ATTRIBUTE)) {
        missing.push(el.outerHTML);
      }
    });
    expect(missing).toEqual([]);
  });

  it('the tab buttons, details summary, and script-marker summary are all present in the fixture', () => {
    const { container } = render(renderMark(SOURCE, defaultRegistry));
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(container.querySelectorAll('.mk-details__summary')).toHaveLength(1);
    expect(container.querySelectorAll('.mk-script__summary')).toHaveLength(1);
  });
});

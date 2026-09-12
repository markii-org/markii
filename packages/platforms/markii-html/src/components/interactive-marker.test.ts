import { describe, expect, it } from 'vitest';
import { INTERACTIVE_ATTRIBUTE } from '@markii/stdlib';
import { renderMarkToHtml } from '../render.js';
import { defaultHtmlRegistry } from './index.js';

/**
 * Executable coverage for #53's host contract (docs/integration.md),
 * mirroring `@markii/react`'s `interactive-marker.test.tsx`: every element
 * this engine emits that is a real `<button>`, carries `role="tab"`/
 * `role="button"`, or is a `<summary>`, must also carry `@markii/stdlib`'s
 * `INTERACTIVE_ATTRIBUTE`. This engine's `Tabs` renders no button bar at
 * all (its own faithfulness-limitation comment explains why: zero-JS,
 * every panel shown), so the only elements in scope here are `details` and
 * a script marker's `<summary>`.
 */
const SOURCE = `
:::details{title="More"}
hidden
:::

\`\`\`lua {name=stars}
return 1
\`\`\`
`;

describe('interactive marker (#53)', () => {
  it('every button/summary/role=tab/role=button element carries the marker', () => {
    const html = renderMarkToHtml(SOURCE, defaultHtmlRegistry);
    const openTags = html.match(/<(button|summary)\b[^>]*>/g) ?? [];
    expect(openTags.length).toBeGreaterThan(0);
    const missing = openTags.filter(
      (tag) => !tag.includes(INTERACTIVE_ATTRIBUTE),
    );
    expect(missing).toEqual([]);
    // Sanity: no role="tab"/role="button" element exists in this engine's
    // output that the tag-based scan above would have missed.
    expect(html).not.toMatch(/role="tab"|role="button"/);
  });

  it('the details summary and script-marker summary are both present in the fixture', () => {
    const html = renderMarkToHtml(SOURCE, defaultHtmlRegistry);
    expect((html.match(/class="mk-details__summary"/g) ?? []).length).toBe(1);
    expect((html.match(/class="mk-script__summary"/g) ?? []).length).toBe(1);
  });
});

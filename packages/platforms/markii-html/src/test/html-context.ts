import { escapeHtml } from '../escape.js';
import type { HtmlRenderContext, ValueResolution } from '../registry.js';

/**
 * A minimal, unbound `HtmlRenderContext` for component unit tests that don't
 * exercise value binding: `resolve` always misses, `valueMarker` renders the
 * ordinary missing-value span. Colocated component tests (`callout.test.ts`
 * and siblings) use this instead of hand-building a context object, so
 * `HtmlRenderContext`'s shape can grow without touching every test file.
 */
export function createTestContext(
  overrides: Partial<HtmlRenderContext> = {},
): HtmlRenderContext {
  return {
    esc: escapeHtml,
    resolve(): ValueResolution {
      return { value: undefined, status: 'missing' };
    },
    valueMarker(name: string): string {
      const label = name.trim() ? name.trim() : 'value';
      return `<span class="mk-value mk-value--missing">{${escapeHtml(label)}}</span>`;
    },
    ...overrides,
  };
}

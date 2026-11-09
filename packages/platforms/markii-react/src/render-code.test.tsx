import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { DiagnosticEvent } from '@markii/stdlib';
import { renderMark, type RenderMarkOptions } from './render';
import { defaultRegistry } from './components';

const FENCE = '```js\nconst a = 1 < 2;\n```';

function html(text: string, options?: RenderMarkOptions): string {
  const { container } = render(
    renderMark(text, defaultRegistry, undefined, undefined, options),
  );
  return container.innerHTML;
}

describe('renderCode option', () => {
  it('an absent option renders as today', () => {
    const base = html(FENCE);
    expect(base).toContain('<pre>');
    expect(html(FENCE, {})).toBe(base);
  });

  it('receives lang and raw code, and its element replaces the block', () => {
    const seen: unknown[] = [];
    const out = html(`${FENCE}\n\ntext`, {
      renderCode: (c) => {
        seen.push(c);
        return <figure className="host">{c.code}</figure>;
      },
    });
    expect(seen).toEqual([{ lang: 'js', code: 'const a = 1 < 2;' }]);
    expect(out).toContain('<figure class="host">const a = 1 &lt; 2;</figure>');
    expect(out).not.toContain('<pre>');
  });

  it('lang is undefined when the fence names none', () => {
    const renderCode = vi.fn(() => undefined);
    html('```\nplain\n```', { renderCode });
    expect(renderCode).toHaveBeenCalledWith({ lang: undefined, code: 'plain' });
  });

  it('undefined renders exactly as today', () => {
    expect(html(FENCE, { renderCode: () => undefined })).toBe(html(FENCE));
  });

  it('a throwing callback renders as today and reports through onDiagnostic', () => {
    const events: DiagnosticEvent[] = [];
    const out = html(FENCE, {
      renderCode: () => {
        throw new Error('nope');
      },
      onDiagnostic: (e) => events.push(e),
    });
    expect(out).toBe(html(FENCE));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('code-renderer-failed');
  });

  it('is never called for a script fence or inline code', () => {
    const renderCode = vi.fn(() => <i />);
    const out = html('```lua {name=calc}\nreturn 1\n```\n\nuse `inline` here', {
      renderCode,
    });
    expect(renderCode).not.toHaveBeenCalled();
    expect(out).toContain('<code>inline</code>');
  });
});

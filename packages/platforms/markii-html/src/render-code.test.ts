import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticEvent } from '@markii/stdlib';
import { renderMarkToHtml } from './render';
import { defaultHtmlRegistry } from './components';

const FENCE = '```js\nconst a = 1 < 2;\n```';

function render(
  text: string,
  options?: Parameters<typeof renderMarkToHtml>[4],
) {
  return renderMarkToHtml(
    text,
    defaultHtmlRegistry,
    undefined,
    undefined,
    options,
  );
}

describe('renderCode option', () => {
  it('default path escapes the code and is unchanged by an absent option', () => {
    const html = render(FENCE);
    expect(html).toContain('const a = 1 &#x3C; 2;');
    expect(html).not.toContain('1 < 2');
    expect(render(FENCE, {})).toBe(html);
  });

  it('receives lang and raw code, and its string is inserted as-is', () => {
    const seen: unknown[] = [];
    const html = render(`${FENCE}\n\ntext`, {
      renderCode: (c) => {
        seen.push(c);
        return `<figure class="host"><b>${c.code}</b></figure>`;
      },
    });
    expect(seen).toEqual([{ lang: 'js', code: 'const a = 1 < 2;' }]);
    expect(html).toContain(
      '<figure class="host"><b>const a = 1 < 2;</b></figure>',
    );
    expect(html).not.toContain('<pre>');
  });

  it('lang is undefined when the fence names none', () => {
    const renderCode = vi.fn(() => undefined);
    render('```\nplain\n```', { renderCode });
    expect(renderCode).toHaveBeenCalledWith({ lang: undefined, code: 'plain' });
  });

  it('undefined renders exactly as today', () => {
    expect(render(FENCE, { renderCode: () => undefined })).toBe(render(FENCE));
  });

  it('a throwing callback renders as today and reports through onDiagnostic', () => {
    const events: DiagnosticEvent[] = [];
    const html = render(FENCE, {
      renderCode: () => {
        throw new Error('nope');
      },
      onDiagnostic: (e) => events.push(e),
    });
    expect(html).toBe(render(FENCE));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('code-renderer-failed');
    expect(events[0]?.message).toContain('code renderer failed');
  });

  it('is never called for a script fence or inline code', () => {
    const renderCode = vi.fn(() => '<x/>');
    const html = render(
      '```lua {name=calc}\nreturn 1\n```\n\nuse `inline` here',
      {
        renderCode,
      },
    );
    expect(renderCode).not.toHaveBeenCalled();
    expect(html).toContain('mk-script');
    expect(html).toContain('<code>inline</code>');
  });
});

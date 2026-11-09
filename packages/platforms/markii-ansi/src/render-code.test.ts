import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticEvent } from '@markii/stdlib';
import { renderMarkToAnsi, type RenderMarkOptions } from './render';

const FENCE = '```js\nconst a = 1;\n```';

function render(text: string, options?: RenderMarkOptions): Promise<string> {
  return renderMarkToAnsi(text, undefined, undefined, undefined, {
    width: 60,
    color: 'never',
    ...options,
  });
}

describe('renderCode option', () => {
  it('an absent option renders as today', async () => {
    expect(await render(FENCE, {})).toBe(await render(FENCE));
  });

  it('receives lang and code, and its string replaces the block', async () => {
    const seen: unknown[] = [];
    const out = await render(`${FENCE}\n\ntext`, {
      renderCode: (c) => {
        seen.push(c);
        return `HOST<${c.code}>`;
      },
    });
    expect(seen).toEqual([{ lang: 'js', code: 'const a = 1;' }]);
    expect(out).toContain('HOST<const a = 1;>');
  });

  it('hands the callback sanitized text, never an author escape', async () => {
    const seen: string[] = [];
    await render('```\nbad\u001b[31mred\n```', {
      renderCode: (c) => {
        seen.push(c.code);
        return undefined;
      },
    });
    expect(seen[0]).not.toContain('\u001b');
  });

  it('lang is undefined when the fence names none', async () => {
    const renderCode = vi.fn(() => undefined);
    await render('```\nplain\n```', { renderCode });
    expect(renderCode).toHaveBeenCalledWith({ lang: undefined, code: 'plain' });
  });

  it('undefined renders exactly as today', async () => {
    expect(await render(FENCE, { renderCode: () => undefined })).toBe(
      await render(FENCE),
    );
  });

  it('a throwing callback renders as today and reports through onDiagnostic', async () => {
    const events: DiagnosticEvent[] = [];
    const out = await render(FENCE, {
      renderCode: () => {
        throw new Error('nope');
      },
      onDiagnostic: (e) => events.push(e),
    });
    expect(out).toBe(await render(FENCE));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('code-renderer-failed');
  });

  it('is never called for a script fence or inline code', async () => {
    const renderCode = vi.fn(() => 'X');
    await render('```lua {name=calc}\nreturn 1\n```\n\nuse `inline` here', {
      renderCode,
    });
    expect(renderCode).not.toHaveBeenCalled();
  });
});

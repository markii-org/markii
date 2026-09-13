import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

describe('Figure', () => {
  it('renders alt, src, and caption each on their own line', async () => {
    const out = await renderMarkToAnsi(
      ':::figure{src="https://x.test/cat.png" alt="A cat"}\nA cat, napping.\n:::\n',
    );
    const lines = out.trim().split('\n');
    expect(lines[0]).toContain('A cat');
    expect(lines[1]).toContain('cat.png');
    expect(lines[2]).toContain('napping');
  });

  it('refuses an unsafe src and omits the image line, reporting a diagnostic', async () => {
    const diagnostics: unknown[] = [];
    const out = await renderMarkToAnsi(
      ':::figure{src="javascript:alert(1)"}\ncaption\n:::\n',
      undefined,
      undefined,
      undefined,
      { onDiagnostic: (d) => diagnostics.push(d) },
    );
    expect(out).not.toContain('javascript:');
    expect(out).toContain('[figure: image not shown]');
    expect(out).not.toContain('refused as unsafe');
    expect(diagnostics.length).toBe(1);
    expect((diagnostics[0] as { message: string }).message).toContain(
      'refused as unsafe',
    );
  });

  it('shows only the caption when src is absent', async () => {
    const out = await renderMarkToAnsi(':::figure\ncaption only\n:::\n');
    expect(out.trim()).toBe('caption only');
  });
});

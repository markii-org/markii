import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

const DOC =
  '::::tabs\n:::tab{label="A"}\nfirst panel\n:::\n:::tab{label="B"}\nsecond panel\n:::\n::::\n';

describe('Tabs / Tab', () => {
  it('stacks every panel with a bold heading line each', async () => {
    const out = await renderMarkToAnsi(DOC);
    expect(out).toContain('A');
    expect(out).toContain('first panel');
    expect(out).toContain('B');
    expect(out).toContain('second panel');
  });

  it('marks only the first tab as active', async () => {
    const out = await renderMarkToAnsi(DOC);
    const occurrences = out.split('(active)').length - 1;
    expect(occurrences).toBe(1);
    expect(out.indexOf('A')).toBeLessThan(out.indexOf('(active)'));
    expect(out.indexOf('(active)')).toBeLessThan(out.indexOf('B'));
  });

  it('a standalone tab (outside tabs) shows its heading and panel with no active marker', async () => {
    const out = await renderMarkToAnsi(':::tab{label="Solo"}\ncontent\n:::\n');
    expect(out).toContain('Solo');
    expect(out).toContain('content');
    expect(out).not.toContain('(active)');
  });

  it('defaults the tab label to "Tab" when absent', async () => {
    const out = await renderMarkToAnsi(':::tab\nx\n:::\n');
    expect(out).toContain('Tab');
  });
});

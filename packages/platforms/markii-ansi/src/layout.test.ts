import { describe, expect, it } from 'vitest';
import { applyLayout, resolveLayoutAttributes } from './layout.js';
import { measureWidth } from './text-grid.js';

describe('resolveLayoutAttributes', () => {
  it('strips width/align and returns the resolved presets', () => {
    const result = resolveLayoutAttributes({ width: 'wide', align: 'center' });
    expect(result.attributes).toEqual({});
    expect(result.resolved).toEqual({ width: 'wide', align: 'center' });
  });

  it('width=normal resolves to no preset (the explicit default)', () => {
    const result = resolveLayoutAttributes({ width: 'normal' });
    expect(result.attributes).toEqual({});
    expect(result.resolved).toBeUndefined();
  });

  it('an invalid value is dropped silently, never throwing', () => {
    const result = resolveLayoutAttributes({ width: 'huge' });
    expect(result.resolved).toBeUndefined();
  });

  it('an owned axis strips its attribute but produces no preset for it', () => {
    const result = resolveLayoutAttributes(
      { width: 'wide', align: 'right' },
      'align',
    );
    expect(result.attributes).toEqual({});
    expect(result.resolved).toEqual({ width: 'wide' });
  });

  it('leaves unrelated attributes untouched', () => {
    const result = resolveLayoutAttributes({ type: 'info' });
    expect(result.attributes).toEqual({ type: 'info' });
    expect(result.resolved).toBeUndefined();
  });

  it('a __proto__ attribute name is never mistaken for a real key', () => {
    const result = resolveLayoutAttributes(
      JSON.parse('{"__proto__": "x"}') as Record<string, string>,
    );
    expect(result.resolved).toBeUndefined();
  });
});

describe('applyLayout', () => {
  it('returns the block unchanged when there is no layout', () => {
    expect(applyLayout('hello', undefined, 40)).toBe('hello');
  });

  it('narrow halves the width, rounded', () => {
    const block = 'a'.repeat(30);
    const result = applyLayout(block, { width: 'narrow' }, 40);
    for (const line of result.split('\n'))
      expect(measureWidth(line)).toBeLessThanOrEqual(20);
  });

  it('narrow never shrinks below the 20-column minimum', () => {
    const block = 'a'.repeat(10);
    const result = applyLayout(block, { width: 'narrow' }, 20);
    expect(measureWidth(result.split('\n')[0] ?? '')).toBeLessThanOrEqual(10);
  });

  it('wide and full both use the full available width (no narrowing)', () => {
    const block = 'hello world';
    expect(applyLayout(block, { width: 'wide' }, 40)).toBe(block);
    expect(applyLayout(block, { width: 'full' }, 40)).toBe(block);
  });

  it("fit shrinks to the block's own widest line, capped at the available width", () => {
    const block = 'hi\nthere';
    const result = applyLayout(block, { width: 'fit' }, 40);
    expect(result).toBe(block);
  });

  it('align places the block within the full width via pad', () => {
    const result = applyLayout('hi', { align: 'right' }, 10);
    expect(result).toBe('        hi');
  });

  it('align combined with a width preset narrows first, then aligns within the full width', () => {
    const result = applyLayout('hi', { width: 'narrow', align: 'center' }, 40);
    expect(measureWidth(result)).toBe(40);
  });
});

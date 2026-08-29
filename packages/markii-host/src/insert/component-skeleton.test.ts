import { describe, expect, it } from 'vitest';
import { componentSkeleton, offsetToLineColumn } from './component-skeleton.js';

describe('componentSkeleton', () => {
  it('container with no required attributes: cursor on the empty middle line', () => {
    const skeleton = componentSkeleton('callout', 'container', []);
    expect(skeleton.text).toBe(':::callout{}\n\n:::');
    expect(skeleton.cursorOffset).toBe(':::callout{}\n'.length);
    expect(skeleton.text.slice(0, skeleton.cursorOffset)).toBe(
      ':::callout{}\n',
    );
    expect(skeleton.text[skeleton.cursorOffset]).toBe('\n');
  });

  it('container with required attributes: cursor inside the first quotes', () => {
    const skeleton = componentSkeleton('figure', 'container', ['src']);
    expect(skeleton.text).toBe(':::figure{src=""}\n\n:::');
    expect(skeleton.cursorOffset).toBe(':::figure{src="'.length);
  });

  it('leaf with no required attributes: cursor between the braces', () => {
    const skeleton = componentSkeleton('rating', 'leaf', []);
    expect(skeleton.text).toBe('::rating{}');
    expect(skeleton.cursorOffset).toBe('::rating{'.length);
  });

  it('leaf with required attributes: cursor inside the first quotes', () => {
    const skeleton = componentSkeleton('widget', 'leaf', ['id']);
    expect(skeleton.text).toBe('::widget{id=""}');
    expect(skeleton.cursorOffset).toBe('::widget{id="'.length);
  });

  it('inline with no required attributes: cursor between the brackets, no trailing {}', () => {
    const skeleton = componentSkeleton('kbd', 'inline', []);
    expect(skeleton.text).toBe(':kbd[]');
    expect(skeleton.cursorOffset).toBe(':kbd['.length);
  });

  it('inline with required attributes: cursor inside the first quotes', () => {
    const skeleton = componentSkeleton('badge', 'inline', ['href']);
    expect(skeleton.text).toBe(':badge[]{href=""}');
    expect(skeleton.cursorOffset).toBe(':badge[]{href="'.length);
  });

  it('renders several required attributes in order, space-separated', () => {
    const skeleton = componentSkeleton('thing', 'leaf', ['a', 'b']);
    expect(skeleton.text).toBe('::thing{a="" b=""}');
    // Cursor is inside the FIRST attribute's quotes, not the last.
    expect(skeleton.cursorOffset).toBe('::thing{a="'.length);
  });
});

describe('offsetToLineColumn', () => {
  it('returns line 0 for an offset on the first line', () => {
    expect(offsetToLineColumn('hello world', 5)).toEqual({
      line: 0,
      column: 5,
    });
  });

  it('counts newlines to find later lines', () => {
    const text = 'one\ntwo\nthree';
    // offset of 't' in "three"
    const offset = text.indexOf('three');
    expect(offsetToLineColumn(text, offset)).toEqual({ line: 2, column: 0 });
  });

  it('finds a column mid-line on a later line', () => {
    const text = 'one\ntwo\nthree';
    const offset = text.indexOf('ree');
    expect(offsetToLineColumn(text, offset)).toEqual({ line: 2, column: 2 });
  });

  it('clamps a negative offset to the start', () => {
    expect(offsetToLineColumn('abc', -5)).toEqual({ line: 0, column: 0 });
  });

  it('clamps an offset past the end to the end of the text', () => {
    const text = 'ab\ncd';
    expect(offsetToLineColumn(text, 999)).toEqual({ line: 1, column: 2 });
  });

  it('handles an offset exactly at a newline as the start of the next line', () => {
    const text = 'ab\ncd';
    const offset = text.indexOf('\n') + 1;
    expect(offsetToLineColumn(text, offset)).toEqual({ line: 1, column: 0 });
  });

  it('handles the empty string', () => {
    expect(offsetToLineColumn('', 0)).toEqual({ line: 0, column: 0 });
  });
});

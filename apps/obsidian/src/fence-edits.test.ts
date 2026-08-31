import { describe, expect, it } from 'vitest';
import { fenceEditorChanges } from './fence-edits.js';

const CONTAINER_SKELETON = ':::tabs{}\n\n:::';

describe('fenceEditorChanges', () => {
  it('spans exactly the colon run it lengthens', () => {
    const text = [':::card{}', '', '', ':::'].join('\n');
    expect(fenceEditorChanges(text, 2, CONTAINER_SKELETON)).toEqual([
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 }, text: '::::' },
      { from: { line: 3, ch: 0 }, to: { line: 3, ch: 3 }, text: '::::' },
    ]);
  });

  it('cascades outward and stays in document order', () => {
    const text = ['::::center{}', ':::card{}', '', ':::', '::::'].join('\n');
    expect(
      fenceEditorChanges(text, 2, CONTAINER_SKELETON).map((c) => c.from.line),
    ).toEqual([0, 1, 3, 4]);
  });

  it('offsets the span by the fence indentation', () => {
    const text = ['  :::card{}', '', '  :::'].join('\n');
    expect(fenceEditorChanges(text, 1, CONTAINER_SKELETON)).toEqual([
      { from: { line: 0, ch: 2 }, to: { line: 0, ch: 5 }, text: '::::' },
      { from: { line: 2, ch: 2 }, to: { line: 2, ch: 5 }, text: '::::' },
    ]);
  });

  it('returns nothing at the top level, for a leaf insertion, or for an unpaired document', () => {
    expect(fenceEditorChanges('plain\n\ntext', 1, CONTAINER_SKELETON)).toEqual(
      [],
    );
    const text = [':::card{}', '', '', ':::'].join('\n');
    expect(fenceEditorChanges(text, 2, '::divider{}')).toEqual([]);
    expect(
      fenceEditorChanges(':::card{}\n\nnever closed', 1, CONTAINER_SKELETON),
    ).toEqual([]);
  });

  it('never returns a change on the insertion line, so it cannot overlap the insertion itself', () => {
    const text = ['::::center{}', ':::card{}', '', ':::', '::::'].join('\n');
    const changes = fenceEditorChanges(text, 2, CONTAINER_SKELETON);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((change) => change.from.line !== 2)).toBe(true);
  });

  it('degrades to no changes rather than throwing on hostile input', () => {
    expect(
      fenceEditorChanges(undefined as unknown as string, 0, CONTAINER_SKELETON),
    ).toEqual([]);
    expect(fenceEditorChanges('', -5, CONTAINER_SKELETON)).toEqual([]);
  });
});

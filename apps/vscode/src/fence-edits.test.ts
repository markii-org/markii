import { describe, expect, it } from 'vitest';
import {
  completionFenceTextEdits,
  fenceTextEdits,
  isContainerInsertText,
} from './fence-edits.js';

const CONTAINER_SKELETON = ':::tabs{}\n\n:::';

describe('fenceTextEdits', () => {
  it('spans exactly the colon run it lengthens', () => {
    const text = [':::card{}', '', '', ':::'].join('\n');
    expect(fenceTextEdits(text, 2, CONTAINER_SKELETON)).toEqual([
      { line: 0, startColumn: 0, endColumn: 3, newText: '::::' },
      { line: 3, startColumn: 0, endColumn: 3, newText: '::::' },
    ]);
  });

  it('offsets the span by the fence indentation', () => {
    const text = ['  :::card{}', '', '  :::'].join('\n');
    expect(fenceTextEdits(text, 1, CONTAINER_SKELETON)).toEqual([
      { line: 0, startColumn: 2, endColumn: 5, newText: '::::' },
      { line: 2, startColumn: 2, endColumn: 5, newText: '::::' },
    ]);
  });

  it('returns nothing at the top level, for a leaf insertion, or for an unpaired document', () => {
    expect(fenceTextEdits('plain\n\ntext', 1, CONTAINER_SKELETON)).toEqual([]);
    const text = [':::card{}', '', '', ':::'].join('\n');
    expect(fenceTextEdits(text, 2, '::divider{}')).toEqual([]);
    expect(
      fenceTextEdits(':::card{}\n\nnever closed', 1, CONTAINER_SKELETON),
    ).toEqual([]);
  });

  it('never returns an edit on the insertion line, so it cannot overlap a completion replace range', () => {
    const text = ['::::center{}', ':::card{}', '', ':::', '::::'].join('\n');
    const edits = fenceTextEdits(text, 2, CONTAINER_SKELETON);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every((edit) => edit.line !== 2)).toBe(true);
  });

  it('degrades to no edits rather than throwing on hostile input', () => {
    expect(
      fenceTextEdits(undefined as unknown as string, 0, CONTAINER_SKELETON),
    ).toEqual([]);
    expect(fenceTextEdits('', -5, CONTAINER_SKELETON)).toEqual([]);
  });
});

describe('isContainerInsertText', () => {
  it('recognizes a container skeleton and nothing else', () => {
    expect(isContainerInsertText(CONTAINER_SKELETON)).toBe(true);
    expect(isContainerInsertText(':::tabs{title=""}\n\n:::')).toBe(true);
    expect(isContainerInsertText('::divider{}')).toBe(false);
    expect(isContainerInsertText(':kbd[]')).toBe(false);
    expect(isContainerInsertText('tabs')).toBe(false);
  });
});

describe('completionFenceTextEdits', () => {
  const text = [':::card{}', ':::ta', ':::'].join('\n');

  it('computes the edits once from the first container item', () => {
    let reads = 0;
    const edits = completionFenceTextEdits(
      () => {
        reads++;
        return text;
      },
      1,
      [
        { insertText: '::divider{}' },
        { insertText: CONTAINER_SKELETON },
        { insertText: ':::card{}\n\n:::' },
      ],
    );
    expect(reads).toBe(1);
    expect(edits).toEqual([
      { line: 0, startColumn: 0, endColumn: 3, newText: '::::' },
      { line: 2, startColumn: 0, endColumn: 3, newText: '::::' },
    ]);
  });

  it('never reads the document when no item is a container', () => {
    let reads = 0;
    const edits = completionFenceTextEdits(
      () => {
        reads++;
        return text;
      },
      1,
      [{ insertText: '::divider{}' }, { insertText: ':kbd[]' }],
    );
    expect(reads).toBe(0);
    expect(edits).toEqual([]);
  });

  it('degrades to no edits when reading the document throws', () => {
    expect(
      completionFenceTextEdits(
        () => {
          throw new Error('document gone');
        },
        1,
        [{ insertText: CONTAINER_SKELETON }],
      ),
    ).toEqual([]);
  });
});

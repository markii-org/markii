import { describe, expect, it } from 'vitest';
import {
  completionFenceTextEdits,
  isContainerInsertText,
} from './fence-edits.js';

const CONTAINER_SKELETON = ':::tabs{}\n\n:::';

// `fenceTextEdits` itself (spanning the colon run, indentation offset,
// never touching the insertion line, degrading quietly on hostile input)
// is no longer exported: the `markii.insertComponent` command path now
// goes through `@markii/host`'s `insertComponentPlan`, which is built on
// the SAME underlying `fenceExtensionEdits`/`insertedContainerColonCount`
// primitives and carries that exact coverage in
// `packages/markii-host/src/host/editor-behavior.test.ts`. What remains
// worth testing here is `completionFenceTextEdits`'s own composition
// (below) and `isContainerInsertText`, which extension.ts still calls
// directly for the completion-popup's `additionalTextEdits` decision.

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

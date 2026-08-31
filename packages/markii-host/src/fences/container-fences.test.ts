import { describe, expect, it } from 'vitest';
import {
  enclosingContainerFences,
  fenceExtensionEdits,
  insertedContainerColonCount,
} from './container-fences.js';

/** The container skeleton `componentSkeleton` builds for a component with no required attributes. */
function containerSkeleton(name: string, colons = 3): string {
  const run = ':'.repeat(colons);
  return `${run}${name}{}\n\n${run}`;
}

/** Convenience: the document as lines, so a test reads like the file it describes. */
function doc(...lines: string[]): string {
  return lines.join('\n');
}

describe('enclosingContainerFences', () => {
  it('finds the single pair around an insertion line', () => {
    const text = doc(':::card{}', '', 'body', '', ':::');
    expect(enclosingContainerFences(text, 2)).toEqual([
      {
        openLine: 0,
        closeLine: 4,
        colonCount: 3,
        openColumn: 0,
        closeColumn: 0,
        directiveName: 'card',
      },
    ]);
  });

  it('returns nested pairs outermost first', () => {
    const text = doc('::::center{}', ':::card{}', '', ':::', '::::');
    const pairs = enclosingContainerFences(text, 2);
    expect(pairs?.map((p) => p.directiveName)).toEqual(['center', 'card']);
    expect(pairs?.map((p) => p.colonCount)).toEqual([4, 3]);
  });

  it('ignores a sibling container that closes before the insertion line', () => {
    const text = doc(
      ':::card{}',
      'first',
      ':::',
      '',
      ':::card{}',
      '',
      ':::',
      '',
      'after',
    );
    expect(enclosingContainerFences(text, 5)?.map((p) => p.openLine)).toEqual([
      4,
    ]);
    // Outside both siblings: nothing encloses the insertion point.
    expect(enclosingContainerFences(text, 8)).toEqual([]);
  });

  it('reads the insertion line only for code-fence state, never as a fence', () => {
    // Mid-keystroke text on the insertion line would otherwise look like a
    // dangling opener and suppress the extension the author is about to need.
    const text = doc(':::card{}', ':::ca', ':::');
    expect(enclosingContainerFences(text, 1)?.map((p) => p.colonCount)).toEqual(
      [3],
    );
  });

  it('ignores :: leaf and : inline directives', () => {
    const text = doc(
      ':::card{}',
      '::divider{}',
      'text with :kbd[Ctrl] inline',
      '',
      ':::',
    );
    expect(enclosingContainerFences(text, 3)?.map((p) => p.openLine)).toEqual([
      0,
    ]);
  });

  it('does not count ::: lines inside a backtick code fence', () => {
    const text = doc(
      ':::card{}',
      '```md',
      ':::example{}',
      ':::',
      '```',
      '',
      ':::',
    );
    expect(enclosingContainerFences(text, 5)?.map((p) => p.openLine)).toEqual([
      0,
    ]);
  });

  it('does not count ::: lines inside a tilde code fence', () => {
    const text = doc(':::card{}', '~~~', ':::', '~~~', '', ':::');
    expect(enclosingContainerFences(text, 4)?.map((p) => p.openLine)).toEqual([
      0,
    ]);
  });

  it('does not let a shorter inner backtick run close a longer code fence', () => {
    const text = doc(':::card{}', '````', '```', ':::', '````', '', ':::');
    expect(enclosingContainerFences(text, 5)?.map((p) => p.openLine)).toEqual([
      0,
    ]);
  });

  it('refuses an unterminated code fence', () => {
    expect(
      enclosingContainerFences(doc(':::card{}', '```', '', ':::'), 2),
    ).toBe(undefined);
  });

  it('refuses a dangling opener', () => {
    expect(enclosingContainerFences(doc(':::card{}', '', 'body'), 1)).toBe(
      undefined,
    );
  });

  it('refuses a dangling closer', () => {
    expect(enclosingContainerFences(doc('body', '', ':::'), 1)).toBe(undefined);
  });

  it('refuses same-count nesting, which does not actually nest', () => {
    const text = doc(':::card{}', ':::details{}', '', ':::', ':::');
    expect(enclosingContainerFences(text, 2)).toBe(undefined);
  });

  it('refuses a closer whose colon count does not match its opener', () => {
    expect(enclosingContainerFences(doc('::::card{}', '', '::::::'), 1)).toBe(
      undefined,
    );
  });

  it('refuses a colon run with no directive name', () => {
    expect(enclosingContainerFences(doc(':::{type=info}', '', ':::'), 1)).toBe(
      undefined,
    );
  });

  it('treats a four-space-indented colon run as code, not a fence', () => {
    // Indented four spaces it is an indented code block in CommonMark, so
    // the surrounding pair is what is seen; the indented line is not a fence.
    const text = doc(':::card{}', '    :::whatever{}', '', ':::');
    expect(enclosingContainerFences(text, 2)?.map((p) => p.openLine)).toEqual([
      0,
    ]);
  });

  it('accepts a fence indented up to three spaces and reports its column', () => {
    const text = doc('  :::card{}', '', '  :::');
    expect(enclosingContainerFences(text, 1)).toEqual([
      {
        openLine: 0,
        closeLine: 2,
        colonCount: 3,
        openColumn: 2,
        closeColumn: 2,
        directiveName: 'card',
      },
    ]);
  });

  it('handles CRLF line endings without dragging the carriage return into columns', () => {
    const text = ':::card{}\r\n\r\n:::\r\n';
    expect(enclosingContainerFences(text, 1)).toEqual([
      {
        openLine: 0,
        closeLine: 2,
        colonCount: 3,
        openColumn: 0,
        closeColumn: 0,
        directiveName: 'card',
      },
    ]);
  });

  it('is defensive about a hostile insertion line', () => {
    const text = doc(':::card{}', '', ':::');
    expect(enclosingContainerFences(text, -1)).toBe(undefined);
    expect(enclosingContainerFences(text, 1.5)).toBe(undefined);
    expect(enclosingContainerFences(text, 9999)).toEqual([]);
  });
});

describe('insertedContainerColonCount', () => {
  it('reads the colon run off a container skeleton', () => {
    expect(insertedContainerColonCount(containerSkeleton('card'))).toBe(3);
    expect(insertedContainerColonCount(containerSkeleton('card', 5))).toBe(5);
  });

  it('is undefined for leaf, inline, and bare-name insertions', () => {
    expect(insertedContainerColonCount('::divider{}')).toBe(undefined);
    expect(insertedContainerColonCount(':kbd[]')).toBe(undefined);
    expect(insertedContainerColonCount('card')).toBe(undefined);
  });

  it('is undefined when the closing run does not match the opening one', () => {
    expect(insertedContainerColonCount(':::card{}\n\n::::')).toBe(undefined);
  });
});

describe('fenceExtensionEdits', () => {
  it('lengthens a single enclosing pair', () => {
    const text = doc(':::card{}', '', '', ':::');
    expect(fenceExtensionEdits(text, 2, containerSkeleton('tabs'))).toEqual([
      { line: 0, column: 0, oldText: ':::', newText: '::::' },
      { line: 3, column: 0, oldText: ':::', newText: '::::' },
    ]);
  });

  it('cascades outward through two levels', () => {
    const text = doc('::::center{}', ':::card{}', '', ':::', '::::');
    expect(fenceExtensionEdits(text, 2, containerSkeleton('tabs'))).toEqual([
      { line: 0, column: 0, oldText: '::::', newText: ':::::' },
      { line: 1, column: 0, oldText: ':::', newText: '::::' },
      { line: 3, column: 0, oldText: ':::', newText: '::::' },
      { line: 4, column: 0, oldText: '::::', newText: ':::::' },
    ]);
  });

  it('leaves an outer pair alone once it is already long enough', () => {
    // `center` is 6 colons: growing `card` to 4 still leaves it strictly
    // longer, so the cascade stops at the inner pair.
    const text = doc('::::::center{}', ':::card{}', '', ':::', '::::::');
    expect(fenceExtensionEdits(text, 2, containerSkeleton('tabs'))).toEqual([
      { line: 1, column: 0, oldText: ':::', newText: '::::' },
      { line: 3, column: 0, oldText: ':::', newText: '::::' },
    ]);
  });

  it('does nothing when the enclosing pair is already long enough', () => {
    const text = doc('::::card{}', '', '', '::::');
    expect(fenceExtensionEdits(text, 2, containerSkeleton('tabs'))).toEqual([]);
  });

  it('does nothing at the top level', () => {
    expect(
      fenceExtensionEdits(
        doc('text', '', 'more'),
        1,
        containerSkeleton('card'),
      ),
    ).toEqual([]);
  });

  it('does nothing for a leaf or inline insertion', () => {
    const text = doc(':::card{}', '', '', ':::');
    expect(fenceExtensionEdits(text, 2, '::divider{}')).toEqual([]);
    expect(fenceExtensionEdits(text, 2, ':kbd[]')).toEqual([]);
  });

  it('does nothing when the document does not pair cleanly', () => {
    const text = doc(':::card{}', '', 'never closed');
    expect(fenceExtensionEdits(text, 1, containerSkeleton('tabs'))).toEqual([]);
  });

  it('measures against the colon run the author actually typed', () => {
    // An author who already typed `::::` gets a 4-colon skeleton, so a
    // 4-colon enclosing pair is no longer long enough.
    const text = doc('::::card{}', '', '', '::::');
    expect(fenceExtensionEdits(text, 2, containerSkeleton('tabs', 4))).toEqual([
      { line: 0, column: 0, oldText: '::::', newText: ':::::' },
      { line: 3, column: 0, oldText: '::::', newText: ':::::' },
    ]);
  });

  it('never edits the insertion line itself', () => {
    const text = doc('::::center{}', ':::card{}', '', ':::', '::::');
    const edits = fenceExtensionEdits(text, 2, containerSkeleton('tabs'));
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every((edit) => edit.line !== 2)).toBe(true);
  });

  it('preserves indentation columns on the lines it rewrites', () => {
    const text = doc('  :::card{}', '', '  :::');
    expect(fenceExtensionEdits(text, 1, containerSkeleton('tabs'))).toEqual([
      { line: 0, column: 2, oldText: ':::', newText: '::::' },
      { line: 2, column: 2, oldText: ':::', newText: '::::' },
    ]);
  });
});

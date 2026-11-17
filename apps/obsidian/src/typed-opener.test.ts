import { describe, expect, it } from 'vitest';
import { createMarkiiHost } from '@markii/host';
import { createObsidianHostAdapter } from './host-adapter.js';
import { typedOpenerChanges } from './typed-opener.js';

function hostOver(text: string) {
  return createMarkiiHost(
    createObsidianHostAdapter({
      prompt: async () => false,
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: () => {},
      editor: {
        documentText: () => text,
        documentPath: () => undefined,
        cursor: () => ({ line: 0, column: 0 }),
        applyEdits: async () => false,
      },
    }),
  );
}

describe('typedOpenerChanges', () => {
  it('turns the host edits into editor changes for the line above the cursor', () => {
    const text = ':::card\n:::callout\n\n:::';
    expect(typedOpenerChanges(hostOver(text), text, 2)).toEqual([
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 }, text: '::::' },
      { from: { line: 3, ch: 0 }, to: { line: 3, ch: 3 }, text: '::::' },
    ]);
  });

  it('is empty for an ordinary line, the first line and an applied result', () => {
    const plain = 'hello\n\nworld';
    expect(typedOpenerChanges(hostOver(plain), plain, 1)).toEqual([]);
    expect(typedOpenerChanges(hostOver(plain), plain, 0)).toEqual([]);
    const done = '::::card\n:::callout\n\n::::';
    expect(typedOpenerChanges(hostOver(done), done, 2)).toEqual([]);
  });
});

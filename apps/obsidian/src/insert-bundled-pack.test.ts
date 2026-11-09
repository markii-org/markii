/**
 * The host contract's catalog covers the plugin's in-memory bundled packs:
 * inserting a bundled-pack component goes through the shared
 * `insertComponent` alone, with no direct-wiring fallback in `main.ts`.
 */
import { describe, expect, it } from 'vitest';
import { createMarkiiHost } from '@markii/host';
import type { HostTextEdit } from '@markii/host';
import { createObsidianHostAdapter } from './host-adapter.js';
import { bundledDiscoveredPacks } from './packs/bundled-packs.js';

describe('insertComponent with a bundled pack component', () => {
  it('inserts through the shared host path', async () => {
    const bundled = bundledDiscoveredPacks([
      {
        name: 'read',
        manifestJson: JSON.stringify({
          name: 'read',
          engine: 'react',
          components: { widget: './Widget.tsx' },
        }),
        scriptText: '',
        luaModules: {},
      },
    ]);
    expect(bundled).toHaveLength(1);
    const directive = 'read_widget';

    let applied: readonly HostTextEdit[] = [];
    const adapter = createObsidianHostAdapter({
      prompt: async () => false,
      loadLocalStorage: () => undefined,
      saveLocalStorage: () => {},
      diagnostics: () => {},
      packs: {
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set<string>(),
        bundledPacks: () => bundled,
      },
      editor: {
        documentText: () => '',
        documentPath: () => undefined,
        cursor: () => ({ line: 0, column: 0 }),
        applyEdits: async (edits) => {
          applied = edits;
          return true;
        },
      },
    });

    const outcome = await createMarkiiHost(adapter).insertComponent({
      name: directive,
    });
    expect(outcome.kind).toBe('inserted');
    expect(applied.length).toBeGreaterThan(0);
    expect(applied.map((e) => e.text).join('')).toContain(directive);
  });
});

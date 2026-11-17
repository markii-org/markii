import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createMarkiiHost } from '@markii/host';
import { createCliHostAdapter } from './host-adapter.js';
import { CLI_LABELS } from './labels.js';
import { loadCliPackRegistry } from './pack-registry.js';
import { packStoreDirectory, resolveCliPackOptions } from './pack-store.js';
import { createFakeTerminal } from './test-terminal.js';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A store holding one pack whose terminal.js throws when evaluated. */
function storeWithBrokenPack(): Record<string, string> {
  const home = mkdtempSync(path.join(tmpdir(), 'markii-cli-registry-'));
  tempDirs.push(home);
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    XDG_CONFIG_HOME: home,
  };
  const folder = path.join(packStoreDirectory(env, process.platform), 'ana');
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, 'pack.json'),
    JSON.stringify({
      name: 'ana',
      engine: 'react',
      version: '1.0.0',
      components: {
        timeline: { sources: { react: './T.tsx', ansi: './T.ansi.tsx' } },
      },
    }),
  );
  writeFileSync(path.join(folder, 'terminal.js'), 'throw new Error("boom");\n');
  return env;
}

async function failureLinesWith(
  labels?: Parameters<typeof loadCliPackRegistry>[1],
): Promise<readonly string[]> {
  const terminal = createFakeTerminal({ env: storeWithBrokenPack() });
  const adapter = createCliHostAdapter({
    terminal,
    memento: {
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
      update: (): Promise<void> => Promise.resolve(),
    },
    packs: resolveCliPackOptions(terminal.env, process.platform),
  });
  const loaded = await loadCliPackRegistry(createMarkiiHost(adapter), labels);
  return loaded.failureLines;
}

describe('loadCliPackRegistry wording', () => {
  it('names the note with the labels it is given', async () => {
    const lines = await failureLinesWith({
      ...CLI_LABELS,
      noteNoun: 'document',
    });
    expect(lines.join('\n')).toContain('failed pack in the document.');
  });

  it('falls back to the command line tool labels', async () => {
    const lines = await failureLinesWith();
    expect(lines.join('\n')).toContain('failed pack in the note.');
  });
});

/**
 * The language server reads a pack's `pack.json` and nothing else. A pack
 * whose `terminal.js` would leave a mark (a file on disk and a global)
 * the moment it is evaluated is installed in the store; opening a note that
 * uses it must publish findings and leave no mark. The note's own scripts
 * are never run either.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { run } from './main.js';
import { createFrameParser, encodeFrame } from './lsp/frames.js';
import type { Json } from './lsp/harness.js';
import { packStoreDirectory } from './pack-store.js';
import { createFakeTerminal } from './test-terminal.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>)['__markiiLspProbeRan'];
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'markii-lsp-probe-'));
  tempDirs.push(dir);
  return dir;
}

function manifest(name: string, sources: Record<string, string>): string {
  return JSON.stringify({
    name,
    engine: 'react',
    version: '1.0.0',
    components: {
      meter: {
        kind: 'leaf',
        sources,
        attributes: [{ name: 'unit', values: ['kg', 'lb'] }],
      },
    },
  });
}

describe('the language server never runs pack code', () => {
  it('publishes findings from pack.json and leaves no mark from terminal.js', async () => {
    const home = tempDir();
    const env = {
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      XDG_CONFIG_HOME: home,
    };
    const store = packStoreDirectory(env, process.platform);
    const marker = path.join(tempDir(), 'terminal-js-ran');

    // A pack with a terminal view whose script would run if it were read.
    const ana = path.join(store, 'ana');
    mkdirSync(ana, { recursive: true });
    writeFileSync(
      path.join(ana, 'pack.json'),
      manifest('ana', { react: './M.tsx', ansi: './M.ansi.tsx' }),
    );
    writeFileSync(
      path.join(ana, 'terminal.js'),
      `globalThis.__markiiLspProbeRan = true;
       process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');
       throw new Error('evaluated');\n`,
    );
    // A pack with no terminal view at all.
    const bee = path.join(store, 'bee');
    mkdirSync(bee, { recursive: true });
    writeFileSync(
      path.join(bee, 'pack.json'),
      manifest('bee', { react: './M.tsx' }),
    );

    const text = [
      '::ana_meter{unit="stone"}',
      '',
      '::bee_meter{unit="kg"}',
      '',
      '::ana_missing{}',
      '',
      ':ana_meter[x]',
      '',
      '```lua {name=side}',
      `require('node:fs')`,
      '```',
      '',
    ].join('\n');

    const terminal = createFakeTerminal({ env });
    const exit = run(['lsp'], terminal);
    const send = (message: object): void =>
      terminal.feed(encodeFrame({ jsonrpc: '2.0', ...message }));
    send({ id: 1, method: 'initialize', params: { capabilities: {} } });
    send({ method: 'initialized', params: {} });
    send({
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///n.mk.md',
          languageId: 'markii',
          version: 1,
          text,
        },
      },
    });
    const deadline = Date.now() + 10_000;
    while (
      !Buffer.concat(terminal.stdoutBytes)
        .toString()
        .includes('publishDiagnostics')
    ) {
      if (Date.now() > deadline) throw new Error('no diagnostics published');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    send({ id: 2, method: 'shutdown' });
    send({ method: 'exit' });
    expect(await exit).toBe(0);

    const parser = createFrameParser();
    const messages = terminal.stdoutBytes
      .flatMap((bytes) => parser.push(bytes))
      .flatMap((item) => (item.kind === 'message' ? [item.value as Json] : []));
    const published = messages.find(
      (m) => m.method === 'textDocument/publishDiagnostics',
    );
    const findings = published?.params.diagnostics as {
      code: string;
      message: string;
    }[];

    expect(findings.map((f) => f.code).sort()).toEqual([
      'form-mismatch',
      'invalid-attribute-value',
      'unknown-directive',
    ]);
    expect(findings.map((f) => f.message).join('\n')).not.toMatch(
      /terminal|engine|view/i,
    );
    expect(existsSync(marker)).toBe(false);
    expect((globalThis as Record<string, unknown>)['__markiiLspProbeRan']).toBe(
      undefined,
    );
  });
});

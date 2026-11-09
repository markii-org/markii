import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { run } from './main.js';
import { createFrameParser, encodeFrame } from './lsp/frames.js';
import type { Json } from './lsp/harness.js';
import { createFakeTerminal } from './test-terminal.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function isolatedEnv(): Record<string, string> {
  const home = mkdtempSync(path.join(tmpdir(), 'markii-lsp-'));
  tempDirs.push(home);
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    XDG_CONFIG_HOME: home,
  };
}

describe('markii lsp through the CLI entry', () => {
  it('speaks LSP over the terminal stdio and exits with the spec code', async () => {
    const terminal = createFakeTerminal({ env: isolatedEnv() });
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
          text: '::nothing{}\n',
        },
      },
    });
    // The check is debounced; wait for it as an editor would.
    const deadline = Date.now() + 5000;
    while (
      !Buffer.concat(terminal.stdoutBytes)
        .toString()
        .includes('publishDiagnostics')
    ) {
      if (Date.now() > deadline) throw new Error('no diagnostics published');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    send({
      id: 2,
      method: 'textDocument/completion',
      params: {
        textDocument: { uri: 'file:///n.mk.md' },
        position: { line: 0, character: 2 },
      },
    });
    send({ id: 3, method: 'shutdown' });
    send({ method: 'exit' });

    expect(await exit).toBe(0);
    expect(terminal.stdioReleased()).toBe(true);

    // Everything on stdout is a protocol frame, and nothing else.
    const parser = createFrameParser();
    const items = terminal.stdoutBytes.flatMap((bytes) => parser.push(bytes));
    expect(items.every((item) => item.kind === 'message')).toBe(true);
    const messages = items.flatMap((item) =>
      item.kind === 'message' ? [item.value as Json] : [],
    );
    expect(
      messages.find((m) => m.id === 1)?.result.capabilities.hoverProvider,
    ).toBe(true);
    const items2 = messages.find((m) => m.id === 2)?.result.items as {
      label: string;
    }[];
    expect(items2.map((item) => item.label)).toContain('divider');
    const diagnostics = messages.find(
      (m) => m.method === 'textDocument/publishDiagnostics',
    );
    expect(diagnostics?.params.diagnostics[0].code).toBe('unknown-directive');
    // Server noise goes to stderr, which carries no protocol.
    expect(terminal.outLines).toEqual([]);
  });

  it('exits 1 when the client closes the stream without shutdown', async () => {
    const terminal = createFakeTerminal({ env: isolatedEnv() });
    const exit = run(['lsp'], terminal);
    terminal.endInput();
    expect(await exit).toBe(1);
  });

  it('rejects arguments with the usage exit code', async () => {
    const terminal = createFakeTerminal();
    expect(await run(['lsp', 'x.mk.md'], terminal)).toBe(3);
  });
});

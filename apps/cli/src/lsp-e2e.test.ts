/**
 * The built `dist/markii.mjs lsp` as a real child process: initialize,
 * open a note, ask for completion and hover, read the diagnostics, shut
 * down, exit. Proves the shipped bundle speaks the protocol on stdio and
 * writes nothing but frames to stdout.
 *
 * The bundle is rebuilt first when it is missing or older than any source
 * file it is built from, so the test never talks to a stale build.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { Json } from './lsp/harness.js';
import { createFrameParser, encodeFrame } from './lsp/frames.js';

const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '..', '..');
const BUNDLE = path.join(APP, 'dist', 'markii.mjs');
const SOURCE_ROOTS = [
  path.join(APP, 'src'),
  path.join(REPO, 'packages'),
  path.join(REPO, 'packs'),
];

function newestSource(dir: string, newest = 0): number {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = newestSource(full, newest);
    else if (/\.(ts|tsx|json|css)$/.test(entry.name)) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

function ensureBundle(): void {
  const stale =
    !existsSync(BUNDLE) ||
    SOURCE_ROOTS.some((root) => newestSource(root) > statSync(BUNDLE).mtimeMs);
  if (!stale) return;
  execFileSync(process.execPath, ['esbuild.config.mjs', '--production'], {
    cwd: APP,
    stdio: 'pipe',
    timeout: 240_000,
  });
}

interface Message {
  id?: number;
  method?: string;
  result?: Json;
  params?: Json;
}

let child: ChildProcess;
let home: string;
const received: Message[] = [];
let stdoutLeftovers = 0;
let stderrText = '';
let exitCode: number | null | undefined;

function waitFor<T>(find: () => T | undefined, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const tick = (): void => {
      const found = find();
      if (found !== undefined) return resolve(found);
      if (Date.now() > deadline) return reject(new Error(`timed out: ${what}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function send(message: object): void {
  child.stdin?.write(encodeFrame({ jsonrpc: '2.0', ...message }));
}

beforeAll(() => {
  ensureBundle();
  home = mkdtempSync(path.join(tmpdir(), 'markii-lsp-e2e-'));
  child = spawn(process.execPath, [BUNDLE, 'lsp'], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, APPDATA: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const parser = createFrameParser();
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const item of parser.push(chunk)) {
      if (item.kind === 'message') received.push(item.value as Message);
      else stdoutLeftovers += 1;
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrText += chunk.toString();
  });
  child.on('exit', (code) => {
    exitCode = code;
  });
}, 300_000);

afterAll(() => {
  child?.kill();
  rmSync(home, { recursive: true, force: true });
});

describe('markii lsp, built bundle', () => {
  it('initialize, open, complete, hover, diagnose, shutdown, exit', async () => {
    const uri = 'file:///tmp/e2e.mk.md';
    const text = '::callout{type="bogus"}\nhi\n::\n\n:::cal\n';
    send({ id: 1, method: 'initialize', params: { capabilities: {} } });
    const init = await waitFor(
      () => received.find((m) => m.id === 1),
      'initialize',
    );
    expect(init.result.capabilities.completionProvider).toBeDefined();
    send({ method: 'initialized', params: {} });
    send({
      method: 'textDocument/didOpen',
      params: { textDocument: { uri, languageId: 'markii', version: 1, text } },
    });

    send({
      id: 2,
      method: 'textDocument/completion',
      params: { textDocument: { uri }, position: { line: 4, character: 6 } },
    });
    const completion = await waitFor(
      () => received.find((m) => m.id === 2),
      'completion',
    );
    const labels = completion.result.items.map(
      (item: { label: string }) => item.label,
    );
    expect(labels).toContain('callout');
    // The bundled packs ride along: their components are in the catalog too.
    expect(
      completion.result.items.some(
        (item: { detail: string }) =>
          !['standard', 'layout'].includes(item.detail),
      ),
    ).toBe(true);

    send({
      id: 3,
      method: 'textDocument/hover',
      params: { textDocument: { uri }, position: { line: 0, character: 4 } },
    });
    const hover = await waitFor(
      () => received.find((m) => m.id === 3),
      'hover',
    );
    expect(hover.result.contents.value).toContain('callout');

    const published = await waitFor(
      () =>
        received.find((m) => m.method === 'textDocument/publishDiagnostics'),
      'diagnostics',
    );
    expect(published.params.diagnostics[0].code).toBe(
      'invalid-attribute-value',
    );

    send({ id: 4, method: 'shutdown' });
    await waitFor(() => received.find((m) => m.id === 4), 'shutdown');
    send({ method: 'exit' });
    await waitFor(
      () => (exitCode === undefined ? undefined : true),
      'process exit',
    );
    expect(exitCode).toBe(0);
    expect(stdoutLeftovers).toBe(0);
    expect(stderrText).toBe('');
  }, 60_000);
});

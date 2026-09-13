import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostPromptRequest } from '@markii/host';
import { createObsidianHostAdapter } from './host-adapter.js';

describe('createObsidianHostAdapter', () => {
  it('is built entirely from injected dependencies (no module-scope global)', () => {
    // Two adapters built from independent dependency sets must never share
    // state — this is what makes the adapter constructible over fakes
    // (batch 11 Phase 3's requirement).
    const linesA: string[] = [];
    const linesB: string[] = [];
    const adapterA = createObsidianHostAdapter({
      prompt: async () => true,
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: (line) => linesA.push(line),
    });
    const adapterB = createObsidianHostAdapter({
      prompt: async () => false,
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: (line) => linesB.push(line),
    });
    adapterA.diagnostics('a');
    adapterB.diagnostics('b');
    expect(linesA).toEqual(['[markii] a']);
    expect(linesB).toEqual(['[markii] b']);
  });

  it('diagnostics adds the "[markii] " prefix the sink itself never adds', () => {
    const lines: string[] = [];
    const adapter = createObsidianHostAdapter({
      prompt: async () => true,
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: (line) => lines.push(line),
    });
    adapter.diagnostics(
      'run (manual) blocked: script execution is off on this device.',
    );
    expect(lines).toEqual([
      '[markii] run (manual) blocked: script execution is off on this device.',
    ]);
  });

  it('id and labels identify this host', () => {
    const adapter = createObsidianHostAdapter({
      prompt: async () => true,
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: () => {},
    });
    expect(adapter.id).toBe('obsidian');
    expect(adapter.labels.appNoun).toBe('plugin');
  });

  it('prompt is a pass-through to the injected function', async () => {
    const seen: HostPromptRequest[] = [];
    const adapter = createObsidianHostAdapter({
      prompt: async (request) => {
        seen.push(request);
        return true;
      },
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: () => {},
    });
    const request: HostPromptRequest = {
      kind: 'grant-host',
      message: 'may this note reach example.com?',
      allowLabel: 'Allow',
      denyLabel: "Don't allow",
      consequential: true,
    };
    await expect(adapter.prompt(request)).resolves.toBe(true);
    expect(seen).toEqual([request]);
  });

  it('memento is backed by the injected local-storage load/save pair, never by a real store', async () => {
    const store = new Map<string, unknown>();
    const adapter = createObsidianHostAdapter({
      prompt: async () => true,
      loadLocalStorage: (key) => (store.has(key) ? store.get(key) : null),
      saveLocalStorage: (key, value) => {
        if (value === null) store.delete(key);
        else store.set(key, value);
      },
      diagnostics: () => {},
    });
    expect(adapter.memento.get('missing', 'fallback')).toBe('fallback');
    await adapter.memento.update('key', { ok: true });
    expect(store.get('key')).toEqual({ ok: true });
    expect(adapter.memento.get('key')).toEqual({ ok: true });
  });

  it('now defaults to the real clock, but a test can inject a fixed one', () => {
    const fixed = createObsidianHostAdapter({
      prompt: async () => true,
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: () => {},
      now: () => 12345,
    });
    expect(fixed.now()).toBe(12345);

    const real = createObsidianHostAdapter({
      prompt: async () => true,
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: () => {},
    });
    expect(real.now()).toBeGreaterThan(0);
  });

  it('omits a capability group entirely when not injected', () => {
    const adapter = createObsidianHostAdapter({
      prompt: async () => true,
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      diagnostics: () => {},
    });
    expect(adapter.isolate).toBeUndefined();
    expect(adapter.packs).toBeUndefined();
    expect(adapter.exports).toBeUndefined();
  });

  describe('filesystem primitives (this plugin is desktop-only)', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'markii-host-adapter-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('readFile/writeFile/exists round-trip bytes', async () => {
      const adapter = createObsidianHostAdapter({
        prompt: async () => true,
        loadLocalStorage: () => null,
        saveLocalStorage: () => {},
        diagnostics: () => {},
      });
      const target = path.join(dir, 'nested', 'file.txt');
      expect(await adapter.exists(target)).toBe(false);
      await adapter.writeFile(target, new TextEncoder().encode('hello'));
      expect(await adapter.exists(target)).toBe(true);
      const bytes = await adapter.readFile(target);
      expect(new TextDecoder().decode(bytes)).toBe('hello');
    });

    it('listFolder resolves a missing folder to an empty list, never throws', async () => {
      const adapter = createObsidianHostAdapter({
        prompt: async () => true,
        loadLocalStorage: () => null,
        saveLocalStorage: () => {},
        diagnostics: () => {},
      });
      await expect(
        adapter.listFolder(path.join(dir, 'does-not-exist')),
      ).resolves.toEqual([]);
    });

    it('listFolder reports entries with their directory-ness', async () => {
      writeFileSync(path.join(dir, 'a.txt'), 'x');
      mkdtempSync(path.join(dir, 'sub-'));
      const adapter = createObsidianHostAdapter({
        prompt: async () => true,
        loadLocalStorage: () => null,
        saveLocalStorage: () => {},
        diagnostics: () => {},
      });
      const entries = await adapter.listFolder(dir);
      const file = entries.find((entry) => entry.name === 'a.txt');
      expect(file?.isDirectory).toBe(false);
      const subdirs = entries.filter((entry) => entry.isDirectory);
      expect(subdirs.length).toBeGreaterThan(0);
    });
  });

  describe('editor capability', () => {
    it('omits editor when no editor is injected', () => {
      const adapter = createObsidianHostAdapter({
        prompt: async () => true,
        loadLocalStorage: () => null,
        saveLocalStorage: () => {},
        diagnostics: () => {},
      });
      expect(adapter.editor).toBeUndefined();
    });

    it('passes an injected editor straight through', async () => {
      const applied: unknown[] = [];
      const adapter = createObsidianHostAdapter({
        prompt: async () => true,
        loadLocalStorage: () => null,
        saveLocalStorage: () => {},
        diagnostics: () => {},
        editor: {
          documentText: () => ':::callout',
          documentPath: () => '/note.mk.md',
          cursor: () => ({ line: 0, column: 5 }),
          applyEdits: async (edits) => {
            applied.push(edits);
            return true;
          },
        },
      });
      expect(adapter.editor?.documentText()).toBe(':::callout');
      expect(adapter.editor?.cursor()).toEqual({ line: 0, column: 5 });
      await expect(adapter.editor?.applyEdits([])).resolves.toBe(true);
      expect(applied).toHaveLength(1);
    });
  });
});

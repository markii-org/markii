/**
 * EXECUTED probe: `runNote` end to end through the REAL Node worker-thread
 * isolate and the REAL wasmoon Lua sandbox — no mock of the worker. This
 * is the point of a probe suite (AGENTS.md, "Security probe suites are
 * product code"): it proves the CLI's own wiring onto `@markii/host`'s
 * shared run path actually spawns a working isolate, not just that the
 * types line up.
 *
 * `runNote` is exercised with no `workerPath` override at all: dev/Vitest
 * runs unbundled, so `./worker-path.ts`'s `resolveWorkerPath` correctly
 * returns `undefined` (no `dist/run/worker.js` built yet), and
 * `@markii/host`'s own `spawnRun` falls back to its `defaultWorkerPath` —
 * the real `worker-entry.ts` run from source via `tsx`. That fallback
 * chain is itself part of what this probe proves works.
 *
 * A real worker plus wasmoon's WASM Lua engine takes real wall-clock time
 * to start; both tests below get a generous per-test timeout.
 */
import { describe, expect, it } from 'vitest';
import type { GrantMemento, Thenable } from '@markii/host';
import { runNote, scriptsFailed } from './run-note.js';
import { createFakeTerminal } from './test-terminal.js';
import type { ResolvedNote } from './read-note.js';

const PROBE_TIMEOUT_MS = 20_000;

/** A plain in-memory `GrantMemento` — no real file, so this suite never touches the real device grant store. */
function fakeMemento(): GrantMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('run-note probe: the real isolate', () => {
  it(
    'runs a script that computes arithmetic and string work with no network, and the value arrives fresh',
    async () => {
      const note: ResolvedNote = {
        text: [
          '```lua {name=total}',
          'local greeting = "hello " .. "world"',
          'return #greeting + (2 + 2)',
          '```',
          '',
        ].join('\n'),
      };
      const terminal = createFakeTerminal({ stdinIsTty: false });
      const memento = fakeMemento();

      const result = await runNote({
        absolutePath: '/tmp/markii-cli-probe-arith.mk.md',
        note,
        terminal,
        memento,
      });

      expect(result.failures).toEqual([]);
      expect(result.values.total?.status).toBe('fresh');
      expect(result.values.total?.value).toBe(15); // "hello world".length (11) + 4
      expect(scriptsFailed(result)).toBe(false);
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    'denies an ungranted net.fetch_json on a non-interactive terminal with capability-denied, no request attempted',
    async () => {
      const note: ResolvedNote = {
        text: [
          '```lua {name=fetched}',
          'return net.fetch_json("https://example.invalid/data")',
          '```',
          '',
        ].join('\n'),
      };
      // A non-TTY terminal: every grant prompt resolves `false` without
      // asking (`host-adapter.ts`), so no host is ever granted and this proves
      // the request is refused at the CAPABILITY gate rather than actually
      // attempted and failing for a network reason.
      const terminal = createFakeTerminal({ stdinIsTty: false });
      const memento = fakeMemento();

      const result = await runNote({
        absolutePath: '/tmp/markii-cli-probe-net.mk.md',
        note,
        terminal,
        memento,
      });

      expect(result.failures).toEqual([
        { name: 'fetched', kind: 'capability-denied' },
      ]);
      expect(scriptsFailed(result)).toBe(true);
    },
    PROBE_TIMEOUT_MS,
  );
});

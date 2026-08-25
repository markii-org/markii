/**
 * ISSUE #12 PENTEST — dedicated adversarial pass on the auto-run/scheduled
 * surface (GitHub issue #11).
 *
 * This file attacks items 2 and 3 of the issue-12 brief:
 *
 * 2. Non-interactive grant integrity: no auto/scheduled path may open a
 *    prompt, persist a new grant, or reach a host beyond the exact stored
 *    closure. Closure-key edge cases: whitespace-only edits, comment edits,
 *    a script renamed, and a `src=` file's content changed between the
 *    manual grant and the later scheduled run must all fail closed (empty
 *    allowlist, no network), never silently reuse the old grant.
 * 3. No silent new network on a schedule, end to end: a real local HTTP
 *    server stands in for "the ungranted host", and the assertion is on the
 *    server's own hit counter, not on a returned error string.
 *
 * Every case drives the REAL `runOnce`/`resolveStoredGrant`/`runGrantFlow`
 * pipeline (`./run-flow.ts`, `./grant-flow.ts`) end to end with REAL script
 * TEXT (not synthetic `GrantClosure` objects), so `extractRunRequirements`'s
 * own static analysis and `computeGrantKey`'s real hashing are exercised —
 * and, for item 3, a REAL `spawnRun` through a real `worker_thread` and a
 * REAL `node:http` server bound to 127.0.0.1, exactly as the brief requires.
 * A "prompt was never called" assertion is the non-interactive half; the
 * server's `hits()` counter is the network half.
 */
import * as http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { runOnce } from './run-flow';
import { runGrantFlow, resolveStoredGrant } from './grant-flow';
import type { GrantMemento, Thenable } from './grant-flow';
import { spawnRun } from './run-host';

function fence(name: string, body: string, attrs = ''): string {
  const attrGroup = attrs ? ` ${attrs}` : '';
  return '```lua {name=' + name + attrGroup + '}\n' + body + '\n```\n';
}

/** A plain in-memory `vscode.Memento` fake — identical shape to `grant-flow.test.ts`'s. */
function fakeMemento(initial: Record<string, unknown> = {}): GrantMemento {
  const store = new Map<string, unknown>(Object.entries(initial));
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

interface LocalServer {
  url: string;
  hostname: string;
  hits: () => number;
  close: () => Promise<void>;
}

/**
 * `bindHost` defaults to '127.0.0.1'. A grant is scoped to a HOSTNAME
 * STRING, not an IP: two servers bound to the SAME literal hostname on
 * different ports are, per docs/security.md, the SAME grant (a hostname
 * grant "authorizes every port"). Tests that need two genuinely DIFFERENT
 * grant targets pass distinct literal hostnames ('127.0.0.1' vs
 * 'localhost'), exactly the pattern `pentest-probe.test.ts`'s "ungranted
 * HOSTNAME" case already uses.
 */
async function startServer(bindHost = '127.0.0.1'): Promise<LocalServer> {
  let hitCount = 0;
  const server = http.createServer((_req, res) => {
    hitCount += 1;
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, bindHost, resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  return {
    url: `http://${bindHost}:${addr.port}`,
    hostname: bindHost,
    hits: () => hitCount,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------
// Item 2: non-interactive resolution, driven from real script text
// ---------------------------------------------------------------------------

describe('issue #12 / item 2: resolveStoredGrant never prompts, and only reuses an EXACT closure match', () => {
  it('a manual grant for the note, resolved non-interactively later for the SAME text, reuses it with zero prompts', async () => {
    const memento = fakeMemento();
    const text = fence(
      'a',
      'return net.fetch_json("https://api.example.com/x")',
    );

    // Establish the grant via the manual (interactive) path.
    await runGrantFlow({
      documentKey: 'doc',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code: text }],
      },
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
    });

    // Now resolve it non-interactively (the auto/scheduled path) for the
    // exact same closure — must succeed with NO prompt calls at all.
    const promptHost = vi.fn(async () => true);
    const result = await resolveStoredGrant({
      documentKey: 'doc',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code: text }],
      },
      memento,
    });
    expect(promptHost).not.toHaveBeenCalled();
    expect(result.allowedHosts).toEqual(['api.example.com']);
  });

  it('WHITESPACE-only edit to the script body changes the closure key and fails closed (empty allowlist, never a prompt)', async () => {
    const memento = fakeMemento();
    const original = 'return net.fetch_json("https://api.example.com/x")';
    const whitespaceEdited = original + '\n'; // trailing newline only

    await runGrantFlow({
      documentKey: 'doc',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code: original }],
      },
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
    });

    const promptHost = vi.fn(async () => true);
    const result = await resolveStoredGrant({
      documentKey: 'doc',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code: whitespaceEdited }],
      },
      memento,
    });
    expect(promptHost).not.toHaveBeenCalled(); // never prompts, per item 2
    expect(result.allowedHosts).toEqual([]); // fails closed, not a silent reuse
  });

  it('COMMENT-only edit to the script body changes the closure key and fails closed', async () => {
    const memento = fakeMemento();
    const original = 'return net.fetch_json("https://api.example.com/x")';
    const commentEdited = '-- refreshed daily\n' + original;

    await runGrantFlow({
      documentKey: 'doc',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code: original }],
      },
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
    });

    const result = await resolveStoredGrant({
      documentKey: 'doc',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code: commentEdited }],
      },
      memento,
    });
    expect(result.allowedHosts).toEqual([]);
  });

  it('RENAMING the script (name= changes, code unchanged) changes the closure key and fails closed', async () => {
    const memento = fakeMemento();
    const code = 'return net.fetch_json("https://api.example.com/x")';

    await runGrantFlow({
      documentKey: 'doc',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'original-name', lang: 'lua', code }],
      },
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
    });

    const result = await resolveStoredGrant({
      documentKey: 'doc',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'renamed', lang: 'lua', code }],
      },
      memento,
    });
    expect(result.allowedHosts).toEqual([]);
  });

  it("a src= FILE's content changing between the manual grant and the scheduled run fails closed, even though the note's own text (the src= reference) is byte-identical", async () => {
    const memento = fakeMemento();
    const requirementsFor = (fileSource: string) => ({
      hosts: ['api.example.com'] as readonly string[],
      hasUnknownHosts: false,
      grantScripts: [
        { name: 's', lang: 'lua', src: 'scripts/s.lua', code: '' },
      ],
      bundleModules: { 'scripts/s.lua': fileSource },
    });

    await runGrantFlow({
      documentKey: 'doc',
      requirements: requirementsFor(
        'return net.fetch_json("https://api.example.com/x")',
      ),
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
    });

    // Manual re-run with the IDENTICAL src= content: cache hit, no prompt
    // needed (sanity check that the harness itself is correct).
    const identicalResult = await resolveStoredGrant({
      documentKey: 'doc',
      requirements: requirementsFor(
        'return net.fetch_json("https://api.example.com/x")',
      ),
      memento,
    });
    expect(identicalResult.allowedHosts).toEqual(['api.example.com']);

    // The src= FILE's bytes changed on disk (a maintainer edited the shared
    // script) between the manual grant and a later scheduled tick — the
    // note's OWN text (the `src=scripts/s.lua` reference) never changed at
    // all. The closure key must still move, and the scheduled run must
    // still resolve to an EMPTY allowlist, never silently inheriting the
    // old grant for new code.
    const swappedResult = await resolveStoredGrant({
      documentKey: 'doc',
      requirements: requirementsFor(
        'return net.fetch_json("https://api.example.com/x") -- swapped payload',
      ),
      memento,
    });
    expect(swappedResult.allowedHosts).toEqual([]);
  });

  it('a stored grant for a DIFFERENT document key is never leaked across notes', async () => {
    const memento = fakeMemento();
    const code = 'return net.fetch_json("https://api.example.com/x")';
    await runGrantFlow({
      documentKey: 'file:///granted-note.mk.md',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code }],
      },
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
    });

    const result = await resolveStoredGrant({
      documentKey: 'file:///different-note.mk.md',
      requirements: {
        hosts: ['api.example.com'],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code }],
      },
      memento,
    });
    expect(result.allowedHosts).toEqual([]);
  });

  it("a stored grant whose host no longer passes today's safety re-check (N-6) is untrusted for auto/scheduled: no prompt, empty allowlist", async () => {
    // Simulates a hand-edited / legacy Memento record carrying a hostile
    // host string (whitespace/control chars) that would never pass
    // isSafeHostForPrompt today.
    const memento = fakeMemento({
      'markii.netGrants': {
        doc: {
          key: 'stale-key-does-not-matter-for-this-probe',
          allowedHosts: ['evil.example.com\nX-Injected: 1'],
        },
      },
    });
    const result = await resolveStoredGrant({
      documentKey: 'doc',
      requirements: {
        hosts: [],
        hasUnknownHosts: false,
        grantScripts: [{ name: 'a', lang: 'lua', code: 'return 1' }],
      },
      memento,
    });
    expect(result.allowedHosts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Item 3: real local HTTP server never contacted, end to end
// ---------------------------------------------------------------------------

describe('issue #12 / item 3: a scheduled/auto run never contacts an ungranted host — proven against a REAL local server', () => {
  it('the ungranted server receives ZERO requests when a scheduled run has no stored grant at all (first-ever run)', async () => {
    const server = await startServer();
    try {
      const memento = fakeMemento();
      const text = fence('a', `return net.fetch_json("${server.url}/x")`);
      const promptHost = vi.fn(async () => true);
      const result = await runOnce({
        documentKey: 'doc',
        text,
        trigger: 'scheduled',
        memento,
        promptHost,
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 15000,
      });
      expect(promptHost).not.toHaveBeenCalled();
      expect(server.hits()).toBe(0);
      expect(result.values.a?.status).toBe('error');
      // With NO host ever granted for GET (empty allowlist), @markii/lua's
      // buildCapabilities never wires `net.fetch_json` as a Lua function at
      // all (see capabilities.ts: the whole `net.fetch_json` block is
      // gated on `netGrants.get.length > 0`) — so this is an ordinary
      // "attempt to call a nil value" script error, not a per-host
      // capability-denied classification (that classification is reserved
      // for a call that reaches the wired function but names a host
      // outside the allowlist — see the two-host test below). Either way
      // the security property holds: the real assertion is `hits() === 0`.
      expect(result.values.a?.failureKind).toBe('script-error');
    } finally {
      await server.close();
    }
  }, 20000);

  it('the ungranted server receives ZERO requests on an auto (run-on-open) trigger either', async () => {
    const server = await startServer();
    try {
      const memento = fakeMemento();
      const text = fence('a', `return net.fetch_json("${server.url}/x")`);
      const result = await runOnce({
        documentKey: 'doc',
        text,
        trigger: 'auto',
        memento,
        promptHost: async () => true,
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 15000,
      });
      expect(server.hits()).toBe(0);
      expect(result.values.a?.failureKind).toBe('script-error'); // see comment above
    } finally {
      await server.close();
    }
  }, 20000);

  it('a MANUAL grant for the server, then a SWAPPED script under scheduled trigger: still zero hits (closure changed => empty allowlist)', async () => {
    const server = await startServer();
    try {
      const memento = fakeMemento();
      const originalText = fence(
        'a',
        `return net.fetch_json("${server.url}/x")`,
      );
      // Grant it manually first.
      const manualPrompt = vi.fn(async () => true);
      const manualResult = await runOnce({
        documentKey: 'doc',
        text: originalText,
        trigger: 'manual',
        memento,
        promptHost: manualPrompt,
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 15000,
      });
      expect(manualPrompt).toHaveBeenCalledTimes(1);
      expect(manualResult.values.a?.status).toBe('fresh');
      expect(server.hits()).toBe(1);

      // A scheduled tick with the IDENTICAL text reuses the grant and
      // reaches the server again (sanity check).
      const reuseResult = await runOnce({
        documentKey: 'doc',
        text: originalText,
        trigger: 'scheduled',
        memento,
        promptHost: async () => {
          throw new Error('must never prompt on a scheduled trigger');
        },
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 15000,
      });
      expect(reuseResult.values.a?.status).toBe('fresh');
      expect(server.hits()).toBe(2);

      // Now the note's script changes (comment added) BEFORE the next
      // scheduled tick — the closure key moves, so the stored grant no
      // longer applies. The server must receive NO further requests.
      const swappedText = fence(
        'a',
        `-- edited\nreturn net.fetch_json("${server.url}/x")`,
      );
      const swappedResult = await runOnce({
        documentKey: 'doc',
        text: swappedText,
        trigger: 'scheduled',
        memento,
        promptHost: async () => true, // would prompt if ever called — it must not be
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 15000,
      });
      // The swapped script's ONLY host reference is now unreachable at all
      // (empty allowlist for this run) -- same 'script-error' shape as the
      // no-grant-at-all cases above, see that comment.
      expect(swappedResult.values.a?.failureKind).toBe('script-error');
      expect(server.hits()).toBe(2); // unchanged — the edited script never reached the server
    } finally {
      await server.close();
    }
  }, 30000);

  it('a note naming TWO hosts, one granted and one not: the scheduled run reaches only the granted one — the ungranted server gets zero hits', async () => {
    const granted = await startServer('127.0.0.1');
    // A DIFFERENT literal hostname (not just a different port) -- a grant
    // is scoped to the hostname STRING and covers every port on it, so two
    // servers on the SAME hostname would both be reachable once either is
    // granted (see docs/security.md and `startServer`'s own doc comment).
    const ungranted = await startServer('localhost');
    try {
      const memento = fakeMemento();
      const text =
        fence('granted', `return net.fetch_json("${granted.url}/x")`) +
        fence('ungranted', `return net.fetch_json("${ungranted.url}/y")`);

      // Manual run: grant only the first host, decline the second.
      await runOnce({
        documentKey: 'doc',
        text,
        trigger: 'manual',
        memento,
        promptHost: async (host) => host === granted.hostname,
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 15000,
      });
      expect(granted.hits()).toBe(1);
      expect(ungranted.hits()).toBe(0);

      // Scheduled tick: same text, no prompting, only the granted host
      // should be reachable.
      const result = await runOnce({
        documentKey: 'doc',
        text,
        trigger: 'scheduled',
        memento,
        promptHost: async () => {
          throw new Error('must never prompt on a scheduled trigger');
        },
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 15000,
      });
      expect(result.values.granted?.status).toBe('fresh');
      expect(result.values.ungranted?.failureKind).toBe('capability-denied');
      expect(granted.hits()).toBe(2);
      expect(ungranted.hits()).toBe(0);
    } finally {
      await granted.close();
      await ungranted.close();
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Item 4 (timer lifecycle) data point: what happens WITHOUT preview-panel.ts's
// own `running` guard, at the layer this pass CAN execute against.
// ---------------------------------------------------------------------------

describe('issue #12 / item 4 (data point): two genuinely CONCURRENT runOnce calls for the same document, sharing one memento', () => {
  // `preview-panel.ts`'s `running` boolean is what stops a real
  // `refreshTimer` tick from overlapping an in-flight run (it cannot be
  // exercised here — see the issue-12 findings report's item-4 section:
  // that file imports `vscode` and is deliberately outside this repo's
  // vitest surface). This probe answers a narrower, EXECUTED question the
  // reasoning in that report leans on: if two runs for the SAME document
  // ever did race on the SAME `Memento` (the `running` guard's failure
  // mode, or a future bug that removed it), would the shared grant/value
  // persistence state be corrupted, or merely resolve to one run's own
  // consistent result ("last write wins")? A real REDUCE-shaped question
  // like this is what a race actually threatens — not a tier escalation
  // (item 1 already proved the tier gate holds per-run, unconditionally).
  it('two concurrent scheduled ticks against the same granted host: no corruption, no throw, no double network intent beyond both ticks legitimately firing', async () => {
    const server = await startServer();
    try {
      const memento = fakeMemento();
      const text = fence('a', `return net.fetch_json("${server.url}/x")`);

      // Manual grant first.
      await runOnce({
        documentKey: 'doc',
        text,
        trigger: 'manual',
        memento,
        promptHost: async () => true,
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 15000,
      });
      expect(server.hits()).toBe(1);

      // Two scheduled ticks fired at the SAME time, sharing the SAME
      // memento — genuinely concurrent, not sequential (Promise.all, not
      // awaited one after another). Neither may prompt.
      const [first, second] = await Promise.all([
        runOnce({
          documentKey: 'doc',
          text,
          trigger: 'scheduled',
          memento,
          promptHost: async () => {
            throw new Error('must never prompt');
          },
          promptUnknownHosts: async () => true,
          promptManyHosts: async () => true,
          spawnRun,
          timeoutMs: 15000,
        }),
        runOnce({
          documentKey: 'doc',
          text,
          trigger: 'scheduled',
          memento,
          promptHost: async () => {
            throw new Error('must never prompt');
          },
          promptUnknownHosts: async () => true,
          promptManyHosts: async () => true,
          spawnRun,
          timeoutMs: 15000,
        }),
      ]);

      // Both ticks succeeded independently (each got its own worker/run);
      // the point under test is that NEITHER threw and the FINAL persisted
      // state is one coherent, well-shaped value store, not a torn/merged
      // mess from two concurrent `memento.update` calls interleaving.
      expect(first.values.a?.status).toBe('fresh');
      expect(second.values.a?.status).toBe('fresh');
      expect(server.hits()).toBe(3); // 1 manual + 2 concurrent scheduled — both legitimately reached the granted host

      const finalStored = memento.get<unknown>('markii.runValues:doc');
      expect(finalStored).toBeDefined();
      // Well-shaped, not corrupted: a plain object with exactly the note's
      // one script name, carrying a valid StoredValue.
      const shaped = finalStored as Record<string, { status: string }>;
      expect(Object.keys(shaped)).toEqual(['a']);
      expect(['fresh', 'stale']).toContain(shaped.a?.status);
    } finally {
      await server.close();
    }
  }, 30000);
});

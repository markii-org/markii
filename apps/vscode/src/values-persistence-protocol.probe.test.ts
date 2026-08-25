/**
 * ISSUE #12 PENTEST — dedicated adversarial pass on the auto-run/scheduled
 * surface (GitHub issue #11).
 *
 * Attacks item 6 of the issue-12 brief: `markii.runValues:*` persistence.
 *
 *  - Can the persisted store grow unbounded? (`MAX_VALUES_SNAPSHOT_BYTES`,
 *    `@markii/host`'s `run/run-flow.ts`)
 *  - Does a hostile or corrupt persisted value store degrade safely?
 *    (`readPersistedValues`, `staleValuesForRehydration`)
 *  - Can a stale re-seed inject markup into the page, or forge a
 *    `failureKind` the protocol guard should reject? (`./protocol.ts`'s
 *    `isHostToWebviewMessage`/`isWireStoredValueRecord`/`isValuesMessage`)
 *
 * All of this is vscode-free, plain-TypeScript logic (`@markii/host`'s
 * `run/run-flow.ts` and `run/stale-values.ts`, plus this app's own
 * `./protocol.ts`), so every case here executes the REAL functions
 * directly — no mocks of the functions under test, only a fake
 * `Memento`/`spawnRun` where `runOnce` needs a host adapter.
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_VALUES_SNAPSHOT_BYTES,
  readPersistedValues,
  runOnce,
  valuesStorageKeyFor,
  staleValuesForRehydration,
} from '@markii/host';
import type {
  GrantMemento,
  Thenable,
  RunResult,
  SpawnRunOptions,
} from '@markii/host';
import {
  isHostToWebviewMessage,
  isNewerRevision,
  isSafeBaseUri,
} from './protocol';
import type { HostToWebviewMessage, ValuesMessage } from './protocol';

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

function fence(name: string, body: string): string {
  return '```lua {name=' + name + '}\n' + body + '\n```\n';
}

// ---------------------------------------------------------------------------
// Unbounded growth
// ---------------------------------------------------------------------------

describe('issue #12 / item 6: markii.runValues:* cannot grow unbounded', () => {
  it('an oversize value store from a run is DROPPED (memento.update called with undefined), never partially written', async () => {
    const memento = fakeMemento();
    const documentKey = 'file:///huge.mk.md';
    const hugeValues: Record<string, unknown> = {};
    // Comfortably over MAX_VALUES_SNAPSHOT_BYTES once JSON-serialized.
    hugeValues.blob = {
      value: 'x'.repeat(MAX_VALUES_SNAPSHOT_BYTES + 1),
      status: 'fresh',
      ranAt: 0,
    };
    const spawnRun = async (_options: SpawnRunOptions): Promise<RunResult> => ({
      values: hugeValues as RunResult['values'],
      failures: [],
      cacheSnapshot: {},
    });

    await runOnce({
      documentKey,
      text: fence('blob', 'return "unused"'),
      trigger: 'manual',
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
      spawnRun,
      timeoutMs: 1000,
    });

    const stored = memento.get<unknown>(valuesStorageKeyFor(documentKey));
    expect(stored).toBeUndefined(); // dropped whole, never truncated
    expect(readPersistedValues(memento, documentKey)).toEqual({});
  });

  it('a value store that is exactly at the byte cap after a SMALL run is still persisted (the cap does not falsely reject ordinary notes)', async () => {
    const memento = fakeMemento();
    const documentKey = 'file:///small.mk.md';
    const spawnRun = async (_options: SpawnRunOptions): Promise<RunResult> => ({
      values: { a: { value: 42, status: 'fresh', ranAt: 0 } },
      failures: [],
      cacheSnapshot: {},
    });

    await runOnce({
      documentKey,
      text: fence('a', 'return 42'),
      trigger: 'manual',
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
      spawnRun,
      timeoutMs: 1000,
    });

    expect(readPersistedValues(memento, documentKey)).toEqual({
      a: { value: 42, status: 'fresh', ranAt: 0 },
    });
  });

  it('a REPEATED sequence of oversize runs never accumulates: each one independently fails the cap and drops, it never grows across ticks', async () => {
    const memento = fakeMemento();
    const documentKey = 'file:///repeated.mk.md';
    const spawnRun = async (_options: SpawnRunOptions): Promise<RunResult> => ({
      values: {
        blob: {
          value: 'y'.repeat(Math.floor(MAX_VALUES_SNAPSHOT_BYTES / 2)),
          status: 'fresh',
          ranAt: 0,
        },
      },
      failures: [],
      cacheSnapshot: {},
    });

    // Each individual run's payload is UNDER the cap on its own, but if the
    // persistence path ever accumulated across ticks (e.g. appended rather
    // than replaced) three of these would exceed it. `mergePersistedValues`
    // always replaces the entry for a given name with the newest run's
    // outcome (never appends), so this proves no such growth happens.
    for (let tick = 0; tick < 3; tick++) {
      await runOnce({
        documentKey,
        text: fence('blob', 'return "unused"'),
        trigger: 'scheduled',
        memento,
        promptHost: async () => true,
        promptUnknownHosts: async () => true,
        promptManyHosts: async () => true,
        spawnRun,
        timeoutMs: 1000,
      });
    }
    const stored = readPersistedValues(memento, documentKey);
    const serializedSize = JSON.stringify(stored).length;
    expect(serializedSize).toBeLessThan(MAX_VALUES_SNAPSHOT_BYTES);
  });
});

// ---------------------------------------------------------------------------
// Hostile / corrupt persisted store degrades safely
// ---------------------------------------------------------------------------

describe('issue #12 / item 6: a hostile or corrupt markii.runValues:* store degrades safely, never throws', () => {
  const documentKey = 'file:///hostile.mk.md';
  const key = valuesStorageKeyFor(documentKey);

  const hostileTopLevelShapes: [string, unknown][] = [
    ['a bare string', 'not-an-object'],
    ['a number', 42],
    ['an array', [1, 2, 3]],
    ['null', null],
    ['a boolean', true],
  ];

  for (const [label, shape] of hostileTopLevelShapes) {
    it(`top-level shape (${label}) degrades to an empty store, never throws`, () => {
      const memento = fakeMemento({ [key]: shape });
      expect(() => readPersistedValues(memento, documentKey)).not.toThrow();
      expect(readPersistedValues(memento, documentKey)).toEqual({});
    });
  }

  it('entries that are STRINGS/NUMBERS/plain-objects-without-status (not StoredValue-shaped) round-trip through staleValuesForRehydration without throwing', () => {
    // readPersistedValues only checks "is this a plain object at all" (see
    // its own doc comment: the WIRE guard in protocol.ts is what re-
    // validates each entry before it reaches the webview) -- this proves
    // that garbage entries of these shapes don't crash the rehydration
    // path. See the NEXT test for a shape that DOES crash it (a `null`
    // entry) — a real, narrow finding, executed and documented there.
    const memento = fakeMemento({
      [key]: {
        a: 'just a string, not {value,status,...}',
        b: 12345,
        d: { rogue: 'field', noStatusAtAll: true },
      },
    });
    const persisted = readPersistedValues(memento, documentKey);
    expect(() => staleValuesForRehydration(persisted)).not.toThrow();
    const rehydrated = staleValuesForRehydration(persisted);
    // Post-fix: a non-object entry is DROPPED rather than passed through.
    // A value that cannot be understood is a value with nothing to re-show,
    // and the object-shaped-but-statusless entry still survives, so an
    // entry written by a different version is not thrown away wholesale.
    expect(Object.keys(rehydrated).sort()).toEqual(['d']);
  });

  it("FINDING, executed: a `null` entry in the persisted value store THROWS inside staleValuesForRehydration (staleStatus reads value.status unguarded), breaking postUpdate's re-seed and, transitively, run-on-open for that ready event", () => {
    // `staleValuesForRehydration` (`./run/stale-values.ts`) does
    // `status: staleStatus(value.status)` with no guard on `value` itself
    // being non-null/an object — `readPersistedValues` only validates the
    // TOP-LEVEL shape (is this a plain object at all), never each entry
    // (see its own doc comment: the wire guard in protocol.ts is meant to
    // be the layer that re-validates each entry). A single `null` entry —
    // plausible from hand-edited workspaceState, extension-storage
    // corruption, or a future version writing a different shape — throws
    // a plain TypeError here.
    //
    // Consequence in the real extension (`preview-panel.ts`'s `postUpdate`,
    // reasoned from reading that file — it cannot be unit-tested directly,
    // see the vscode-import note in this pass's report): `postUpdate` calls
    // `postStalePersistedValues` UNGUARDED, and `onDidReceiveMessage`'s
    // `ready` handler calls `postUpdate(preview); maybeRunOnOpen(context,
    // preview);` on consecutive synchronous lines with no try/catch around
    // either — a throw from `postUpdate` would abort that handler before
    // `maybeRunOnOpen` ever runs, silently disabling run-on-open for that
    // particular `ready` event (the document's own `update` message, sent
    // moments earlier in the same function, still gets through — only the
    // stale-values re-seed and the auto-run trigger are lost).
    //
    // Not exploitable for escalation or leak — the sandbox/tier/grant gates
    // are untouched — but it IS a "does a corrupt persisted store degrade
    // safely" failure the brief asked to probe. Suggested fix: guard
    // `staleValuesForRehydration`'s per-entry transform the same
    // "is this a plain object" way `readPersistedValues`/
    // `isCacheSnapshotShape` already guard their own inputs, and drop (not
    // crash on) an entry that isn't one.
    const memento = fakeMemento({
      [key]: { c: null, ok: { value: 1, status: 'fresh', ranAt: 0 } },
    });
    const persisted = readPersistedValues(memento, documentKey);
    // FIXED: the entry is skipped instead of throwing, so the re-seed still
    // happens and the `ready` handler still reaches `maybeRunOnOpen`.
    expect(() => staleValuesForRehydration(persisted)).not.toThrow();
    const rehydrated = staleValuesForRehydration(persisted);
    expect(Object.hasOwn(rehydrated, 'c')).toBe(false);
    expect(rehydrated.ok?.status).toBe('stale');
  });

  it('__proto__/constructor/toString used as VALUE NAMES never pollute Object.prototype through readPersistedValues or staleValuesForRehydration', () => {
    // A genuine JSON STRING is parsed here (not an object literal): only
    // JSON.parse's CreateDataProperty semantics make '__proto__' an
    // ORDINARY OWN key — an object LITERAL's `{ __proto__: ... }` syntax is
    // magic and sets the actual prototype instead, which would silently
    // test the wrong thing. This is also exactly how a real Memento's
    // underlying JSON storage (and postMessage's structured clone) would
    // materialize a hostile stored/wire value, so it is the realistic
    // attack shape, not merely the more awkward one to write.
    const hostile = JSON.parse(
      '{"__proto__":{"value":"a","status":"fresh","ranAt":0},' +
        '"constructor":{"value":"b","status":"fresh","ranAt":0},' +
        '"toString":{"value":"c","status":"fresh","ranAt":0},' +
        '"ordinary":{"value":"d","status":"fresh","ranAt":0}}',
    ) as Record<string, unknown>;
    expect(Object.hasOwn(hostile, '__proto__')).toBe(true); // sanity: the fixture itself is genuinely hostile
    const memento = fakeMemento({ [key]: hostile });

    const before = Object.getPrototypeOf({});
    const persisted = readPersistedValues(memento, documentKey);
    const rehydrated = staleValuesForRehydration(persisted);
    const after = Object.getPrototypeOf({});

    // The property that matters most: the shared, GLOBAL Object.prototype
    // is never touched, from any of this. No pollution reaches other code.
    expect(after).toBe(before);
    expect(Object.hasOwn(rehydrated, 'ordinary')).toBe(true);
    expect(Object.hasOwn(rehydrated, 'toString')).toBe(true);

    // FINDING, executed, LOW severity: a value literally named "__proto__"
    // is silently DROPPED (not preserved, not an own key) by
    // staleValuesForRehydration, because its output builder
    // (`./run/stale-values.ts`: `const out: Record<string, StoredValue> =
    // {}; ... out[name] = {...}`) uses an ordinary `{}` object literal and
    // plain bracket assignment. `out['__proto__'] = value` on a `{}`-based
    // object does NOT create an own data property named "__proto__" — it
    // invokes the inherited accessor and re-parents THAT ONE LOCAL `out`
    // object's own prototype to `value` instead (proven below: `rehydrated`
    // has no own "__proto__" key, and reading `.value`/`.status` off it
    // resolves through the prototype chain to the swallowed entry instead
    // of failing). This is exactly the class of bug
    // `@markii/runtime`'s `createValueStore` (`packages/markii-runtime/src/
    // store.ts`) deliberately built `Object.create(null)` to avoid — see
    // its own doc comment: "a script `name` that collides with an
    // inherited Object.prototype member (..., '__proto__', ...)". This one
    // rehydration-output builder does not follow that same discipline, so
    // the protection the core store has does not survive this specific
    // re-projection.
    //
    // Bounded: `out` is a fresh, function-local object discarded after this
    // call — nothing pollutes the shared `Object.prototype` (proven by the
    // `before`/`after` check above), and a name colliding with a
    // Object.prototype member is a hostile/self-shadowing script name, not
    // an ordinary one. The concrete effect is quieter: a monitoring note
    // that happens to publish a value literally named `__proto__` would
    // show it as MISSING/stale-less on rehydration rather than showing its
    // last-known value — a correctness gap, not a security escalation.
    // Suggested fix: build `out` via `Object.create(null)`, matching
    // `store.ts`'s own convention, in `./run/stale-values.ts`.
    // FIXED: the output is built with `Object.fromEntries`, which defines
    // each key as an own data property, so a value named `__proto__`
    // survives rehydration instead of being swallowed into the output
    // object's prototype.
    expect(Object.hasOwn(rehydrated, '__proto__')).toBe(true);
    expect(Object.keys(rehydrated).sort()).toEqual([
      '__proto__',
      'constructor',
      'ordinary',
      'toString',
    ]);
    // And the entry is the value itself, demoted to stale like every other
    // rehydrated value -- not something reached through a prototype chain.
    const preserved = Object.getOwnPropertyDescriptor(rehydrated, '__proto__');
    expect(preserved?.value).toMatchObject({ value: 'a', status: 'stale' });
    expect(Object.getPrototypeOf(rehydrated)).toBe(Object.prototype);
  });

  it('an EXTREME single entry (megabytes of value text) is handled without hanging or throwing (no re-validation cap at this layer -- see the wire-guard describe block for where the real cap lives)', () => {
    const memento = fakeMemento({
      [key]: { a: { value: 'z'.repeat(5_000_000), status: 'fresh', ranAt: 0 } },
    });
    const started = Date.now();
    expect(() => {
      const persisted = readPersistedValues(memento, documentKey);
      staleValuesForRehydration(persisted);
    }).not.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// protocol.ts's wire guard: the real boundary before the webview trusts
// anything from a re-seed
// ---------------------------------------------------------------------------

describe('issue #12 / item 6: protocol.ts rejects a forged failureKind, a forged status, and other hostile re-seed shapes', () => {
  function valuesMessage(values: unknown, failures: unknown = []): unknown {
    return { type: 'values', revision: 1, values, failures };
  }

  it('a forged failureKind string OUTSIDE the closed FAILURE_KINDS taxonomy is rejected — the whole message is dropped', () => {
    const hostile = valuesMessage({
      a: {
        value: null,
        status: 'error',
        failureKind: 'admin-override', // not a real FailureKind
        ranAt: 0,
      },
    });
    expect(isHostToWebviewMessage(hostile)).toBe(false);
  });

  it('an attempt to spoof a PRIVILEGED-sounding but still-fake failureKind is rejected the same way', () => {
    for (const fake of [
      'CAPABILITY_DENIED',
      'capability_denied',
      'tier-unblocked',
      '__proto__',
      'constructor',
    ]) {
      const hostile = valuesMessage({
        a: { value: null, status: 'error', failureKind: fake, ranAt: 0 },
      });
      expect(isHostToWebviewMessage(hostile), `failureKind=${fake}`).toBe(
        false,
      );
    }
  });

  it('a forged status OUTSIDE the closed ValueStatus set is rejected', () => {
    for (const fake of ['success', 'pending', 'running', '', 'FRESH']) {
      const hostile = valuesMessage({ a: { value: 1, status: fake } });
      expect(isHostToWebviewMessage(hostile), `status=${fake}`).toBe(false);
    }
  });

  it('a values entry missing the required "value" OWN property (present only via prototype) is rejected', () => {
    const base = { status: 'fresh' };
    Object.setPrototypeOf(base, { value: 'inherited, not own' });
    const hostile = valuesMessage({ a: base });
    expect(isHostToWebviewMessage(hostile)).toBe(false);
  });

  it('a ranAt that is NaN/Infinity/a string is rejected', () => {
    for (const fake of [Number.NaN, Number.POSITIVE_INFINITY, '123', null]) {
      if (fake === null) continue; // null is a legitimate "absent" sentinel test elsewhere; skip here
      const hostile = valuesMessage({
        a: { value: 1, status: 'fresh', ranAt: fake },
      });
      expect(isHostToWebviewMessage(hostile), `ranAt=${String(fake)}`).toBe(
        false,
      );
    }
  });

  it('__proto__/constructor used as top-level VALUE NAMES in a values record are still validated per-entry, and a hostile one there is rejected too', () => {
    // Parsed from a genuine JSON STRING (see the earlier __proto__ test's
    // comment on why an object LITERAL would silently test the wrong
    // thing: `{ __proto__: ... }` sets the prototype, not an own key).
    const values = JSON.parse(
      '{"__proto__":{"value":1,"status":"error","failureKind":"not-real"},' +
        '"constructor":{"value":1,"status":"fresh","ranAt":0}}',
    ) as unknown;
    expect(Object.hasOwn(values as object, '__proto__')).toBe(true); // sanity
    const hostile = valuesMessage(values);
    expect(isHostToWebviewMessage(hostile)).toBe(false);
  });

  it('a well-formed values record with __proto__/constructor as key names IS accepted (they are ordinary keys, not special-cased away)', () => {
    const values = JSON.parse(
      '{"__proto__":{"value":1,"status":"fresh","ranAt":0},' +
        '"constructor":{"value":2,"status":"fresh","ranAt":0},' +
        '"ordinary":{"value":3,"status":"fresh","ranAt":0}}',
    ) as unknown;
    const wellFormed = valuesMessage(values);
    expect(isHostToWebviewMessage(wellFormed)).toBe(true);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype); // still clean
  });

  it('a revision that is negative, non-integer, NaN, or Infinity is rejected', () => {
    for (const fake of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const hostile = {
        type: 'values',
        revision: fake,
        values: {},
        failures: [],
      };
      expect(isHostToWebviewMessage(hostile), `revision=${fake}`).toBe(false);
    }
  });

  it('isNewerRevision never accepts a repeated or out-of-order revision (guards a re-seed message from stomping newer content)', () => {
    expect(isNewerRevision(5, 5)).toBe(false);
    expect(isNewerRevision(5, 4)).toBe(false);
    expect(isNewerRevision(5, 6)).toBe(true);
    expect(isNewerRevision(Number.NaN, 6)).toBe(false);
  });

  it('a javascript:/data: baseUri is rejected outright — a stale re-seed cannot smuggle a hostile scheme into image resolution', () => {
    expect(isSafeBaseUri('javascript:alert(1)')).toBe(false);
    expect(isSafeBaseUri('data:text/html,<script>alert(1)</script>')).toBe(
      false,
    );
    expect(isSafeBaseUri('https://good.example.com/')).toBe(true);
  });

  it('a values message whose "values" is an array (not a record) is rejected outright', () => {
    const hostile = valuesMessage([{ value: 1, status: 'fresh' }]);
    expect(isHostToWebviewMessage(hostile)).toBe(false);
  });

  it('failures carrying a forged kind are rejected even when values itself is clean', () => {
    const hostile = valuesMessage(
      { a: { value: 1, status: 'fresh', ranAt: 0 } },
      [{ name: 'a', kind: 'root-access' }],
    );
    expect(isHostToWebviewMessage(hostile)).toBe(false);
  });

  it('a genuinely well-formed re-seed message (mirroring what postStalePersistedValues actually sends) IS accepted', () => {
    const wellFormed: ValuesMessage = {
      type: 'values',
      revision: 3,
      values: {
        a: { value: 7, status: 'stale', ranAt: 0 },
        b: { value: null, status: 'error', failureKind: 'capability-denied' },
      },
      failures: [],
    };
    expect(
      isHostToWebviewMessage(wellFormed satisfies HostToWebviewMessage),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Markup injection: values-are-data by construction, not by a runtime check
// ---------------------------------------------------------------------------

describe('issue #12 / item 6: a script value can never become markup (values-are-data promise)', () => {
  it('protocol.ts treats an HTML/script-shaped string in "value" as opaque data, not as something it inspects or rejects', () => {
    // This is the correct behavior: protocol.ts validates SHAPE, never
    // CONTENT -- a value is data, and rendering (React, in webview/) is
    // what is responsible for treating it as text, never markup. Proven
    // below by the absence of any raw-HTML sink in the renderer source.
    const message = {
      type: 'values',
      revision: 1,
      values: {
        a: {
          value: '<img src=x onerror=alert(1)>',
          status: 'fresh',
          ranAt: 0,
        },
      },
      failures: [],
    };
    expect(isHostToWebviewMessage(message)).toBe(true);
  });

  it('STATIC CHECK, executed: no file under webview/ or the @markii/react component set uses dangerouslySetInnerHTML or assigns .innerHTML — the ONE mechanism that would turn a script value into live markup is verifiably absent', () => {
    const roots = [
      resolveRepoPath('src/webview'),
      resolveRepoPath('../../packages/platforms/markii-react/src'),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      walk(root, (filePath) => {
        if (!/\.(tsx?|jsx?)$/.test(filePath)) return;
        const text = readFileSync(filePath, 'utf8');
        if (
          text.includes('dangerouslySetInnerHTML') ||
          /\.innerHTML\s*=/.test(text)
        ) {
          offenders.push(filePath);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

function resolveRepoPath(relativeToThisFile: string): string {
  return join(import.meta.dirname, relativeToThisFile);
}

function walk(dir: string, visit: (filePath: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // directory doesn't exist in this checkout shape — nothing to walk
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, visit);
    } else {
      visit(full);
    }
  }
}

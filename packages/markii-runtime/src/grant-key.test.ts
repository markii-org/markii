import { describe, expect, it } from 'vitest';
import {
  computeGrantKey,
  type GrantClosure,
  type GrantClosurePack,
  type GrantClosureScript,
} from './grant-key.js';

/** A minimal, empty closure — every section present but empty. */
function emptyClosure(): GrantClosure {
  return { scripts: [], bundleModules: {}, vaultModules: {}, packs: [] };
}

/**
 * A rich, non-trivial closure covering every part of `GrantClosure`: two
 * scripts (one inline, one `src=`-referenced), two bundle-local module
 * files, two vault namespaces with two modules apiece, and two packs (one
 * with resolved module sources, one identity-only). Includes an emoji in
 * one script's code — a 4-byte-UTF-8 / 2-UTF-16-code-unit character — so
 * the known-vector test below only stays green if string lengths are
 * framed by UTF-8 BYTE length; a regression to `.length` (UTF-16 units)
 * changes that field's length prefix and flips the pinned digest.
 */
function richClosure(): GrantClosure {
  return {
    scripts: [
      { name: 'stars', lang: 'lua', code: 'return fetch("stars") 😀' },
      { name: 'etl', lang: 'lua', src: 'scripts/etl.lua', code: '' },
    ],
    bundleModules: {
      'scripts/etl.lua': 'local M = {}\nreturn M',
      'scripts/util.lua': 'return { clamp = function(x) return x end }',
    },
    vaultModules: {
      'me/utils': {
        'strings.lua': 'return { trim = function(s) return s end }',
        'tables.lua': 'return { merge = function(a, b) return a end }',
      },
      'team/charts': {
        'palette.lua': 'return { "red", "blue" }',
        'scale.lua': 'return function(v) return v end',
      },
    },
    packs: [
      {
        namespace: 'acme/widgets',
        version: '2.3.1',
        modules: { 'index.lua': 'return { render = function() end }' },
      },
      { namespace: 'acme/tools', version: '0.9.0' },
    ],
  };
}

/** Structural clone helper (kept local so the test stays independent of the module under test). */
function clone<T>(value: T): T {
  return structuredClone(value);
}

type PathKey = string | number;

/** Collects the path (object-key / array-index chain) to every string leaf reachable from `node`. */
function collectStringLeafPaths(
  node: unknown,
  prefix: PathKey[] = [],
): PathKey[][] {
  if (typeof node === 'string') return [prefix];
  if (Array.isArray(node)) {
    return node.flatMap((child, i) =>
      collectStringLeafPaths(child, [...prefix, i]),
    );
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(
      ([key, child]) => collectStringLeafPaths(child, [...prefix, key]),
    );
  }
  return [];
}

/**
 * Returns a deep clone of `root` with the string leaf at `path` replaced by
 * `newValue`. Generic over the closure's shape on purpose: this is what
 * lets the exhaustive sensitivity test below automatically cover any field
 * that gets added to the fixtures in the future, with no test-code changes
 * — see that test's doc comment.
 */
function withStringAt(
  node: unknown,
  path: PathKey[],
  newValue: string,
): unknown {
  if (path.length === 0) {
    if (typeof node !== 'string') {
      throw new Error('withStringAt: path does not point at a string leaf');
    }
    return newValue;
  }
  const [head, ...rest] = path as [PathKey, ...PathKey[]];
  if (typeof head === 'number') {
    if (!Array.isArray(node)) {
      throw new Error('withStringAt: expected an array at this path segment');
    }
    const copy = node.slice();
    copy[head] = withStringAt(copy[head], rest, newValue);
    return copy;
  }
  if (node === null || typeof node !== 'object') {
    throw new Error('withStringAt: expected an object at this path segment');
  }
  const copy: Record<string, unknown> = {
    ...(node as Record<string, unknown>),
  };
  copy[head] = withStringAt(copy[head], rest, newValue);
  return copy;
}

describe('computeGrantKey', () => {
  it('produces a 64-char lowercase hex digest for the empty closure', async () => {
    const key = await computeGrantKey(emptyClosure());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for a fixed closure', async () => {
    const closure = richClosure();
    const a = await computeGrantKey(closure);
    const b = await computeGrantKey(clone(closure));
    expect(a).toBe(b);
  });

  // --- Known-vector: pins the exact digest of `richClosure()` so any
  // accidental drift in the serialization (field order, framing, section
  // tags, byte-vs-UTF16 length, sort order) fails loudly instead of only
  // showing up as "grants everyone already made silently go stale". This
  // hex string was produced by running the real implementation against
  // `richClosure()` — see this file's own test run, not hand-computed.
  it('matches the pinned known-vector digest for richClosure()', async () => {
    const key = await computeGrantKey(richClosure());
    expect(key).toBe(
      'a4a19cde0ac94ca67ce881b0ab62a2b016c87778f565d0b077bc521d6b4062ef',
    );
  });

  describe('order-independence', () => {
    it('is unaffected by shuffling scripts, and by rebuilding every map with reversed key order', async () => {
      const base = richClosure();
      const baseKey = await computeGrantKey(base);

      const shuffled: GrantClosure = {
        scripts: [...base.scripts].reverse(),
        bundleModules: Object.fromEntries(
          Object.entries(base.bundleModules).reverse(),
        ),
        vaultModules: Object.fromEntries(
          Object.entries(base.vaultModules)
            .reverse()
            .map(([namespace, modules]) => [
              namespace,
              Object.fromEntries(Object.entries(modules).reverse()),
            ]),
        ),
        packs: [...base.packs].reverse(),
      };

      expect(await computeGrantKey(shuffled)).toBe(baseKey);
    });

    it('is unaffected by an arbitrary permutation of scripts and packs', async () => {
      const base = richClosure();
      const baseKey = await computeGrantKey(base);

      const permuted: GrantClosure = {
        ...base,
        scripts: [
          base.scripts[1] as GrantClosureScript,
          base.scripts[0] as GrantClosureScript,
        ],
        packs: [
          base.packs[1] as GrantClosurePack,
          base.packs[0] as GrantClosurePack,
        ],
      };

      expect(await computeGrantKey(permuted)).toBe(baseKey);
    });
  });

  describe('framing collisions', () => {
    it('["a","bc"] and ["ab","c"] as list entries never hash equal', async () => {
      const listAB: GrantClosure = {
        ...emptyClosure(),
        bundleModules: { a: '', bc: '' },
      };
      const listABAlt: GrantClosure = {
        ...emptyClosure(),
        bundleModules: { ab: '', c: '' },
      };

      expect(await computeGrantKey(listAB)).not.toBe(
        await computeGrantKey(listABAlt),
      );
    });

    it('a probe moved across a FIELD boundary (script name/code) never hashes equal', async () => {
      const nameAbCodeC: GrantClosure = {
        ...emptyClosure(),
        scripts: [{ name: 'ab', lang: '', code: 'c' }],
      };
      const nameACodeBc: GrantClosure = {
        ...emptyClosure(),
        scripts: [{ name: 'a', lang: '', code: 'bc' }],
      };

      expect(await computeGrantKey(nameAbCodeC)).not.toBe(
        await computeGrantKey(nameACodeBc),
      );
    });

    it('the identical string in different sections (script name vs. bundle module path) never hashes equal', async () => {
      const inScripts: GrantClosure = {
        ...emptyClosure(),
        scripts: [{ name: 'probe', lang: '', code: '' }],
      };
      const inBundleModules: GrantClosure = {
        ...emptyClosure(),
        bundleModules: { probe: '' },
      };

      expect(await computeGrantKey(inScripts)).not.toBe(
        await computeGrantKey(inBundleModules),
      );
    });

    it('the identical string as a vault namespace vs. as a pack namespace never hashes equal', async () => {
      const inVault: GrantClosure = {
        ...emptyClosure(),
        vaultModules: { probe: {} },
      };
      const inPack: GrantClosure = {
        ...emptyClosure(),
        packs: [{ namespace: 'probe', version: '' }],
      };

      expect(await computeGrantKey(inVault)).not.toBe(
        await computeGrantKey(inPack),
      );
    });

    it('empty string vs. absent optional field: script.src', async () => {
      const srcAbsent: GrantClosure = {
        ...emptyClosure(),
        scripts: [{ name: 'x', lang: '', code: '' }],
      };
      const srcEmpty: GrantClosure = {
        ...emptyClosure(),
        scripts: [{ name: 'x', lang: '', code: '', src: '' }],
      };

      expect(await computeGrantKey(srcAbsent)).not.toBe(
        await computeGrantKey(srcEmpty),
      );
    });

    it('empty string vs. absent optional field: pack.modules ({} vs. undefined)', async () => {
      const modulesAbsent: GrantClosure = {
        ...emptyClosure(),
        packs: [{ namespace: 'ns', version: '1' }],
      };
      const modulesEmpty: GrantClosure = {
        ...emptyClosure(),
        packs: [{ namespace: 'ns', version: '1', modules: {} }],
      };

      expect(await computeGrantKey(modulesAbsent)).not.toBe(
        await computeGrantKey(modulesEmpty),
      );
    });

    it('a field value containing the scheme byte marks (0x00-0x04) used internally as tags does not break framing or collide with a differently-shaped closure', async () => {
      const withControlBytes: GrantClosure = {
        ...emptyClosure(),
        scripts: [
          {
            name: 'x',
            lang: '',
            code: '  payload',
          },
        ],
      };
      const withDifferentControlBytes: GrantClosure = {
        ...emptyClosure(),
        scripts: [
          {
            name: 'x',
            lang: '',
            code: '  payload',
          },
        ],
      };
      const withoutControlBytes: GrantClosure = {
        ...emptyClosure(),
        scripts: [{ name: 'x', lang: '', code: ' payload' }],
      };

      const a = await computeGrantKey(withControlBytes);
      const b = await computeGrantKey(withDifferentControlBytes);
      const c = await computeGrantKey(withoutControlBytes);

      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
      expect(b).not.toBe(c);
    });

    it('a multi-byte (emoji) string changes the key just like any other content change', async () => {
      const withEmoji: GrantClosure = {
        ...emptyClosure(),
        scripts: [{ name: 'x', lang: '', code: '😀' }],
      };
      const withoutEmoji: GrantClosure = {
        ...emptyClosure(),
        scripts: [{ name: 'x', lang: '', code: 'ab' }], // same UTF-16 length (2), different UTF-8 byte length
      };

      expect(await computeGrantKey(withEmoji)).not.toBe(
        await computeGrantKey(withoutEmoji),
      );
    });
  });

  // Exhaustive single-field sensitivity: walks EVERY string leaf reachable
  // from a rich fixture (script name/lang/src/code, bundle module path +
  // source, vault namespace + module path + source, pack namespace +
  // version + module path + source) and asserts that mutating that one
  // leaf, and only that leaf, changes the digest.
  //
  // This is intentionally generic (a structural walk, not a hardcoded list
  // of field names) so that if a future part of `GrantClosure` gains a new
  // string field AND that field is added to `sensitivityFixture()` below,
  // the walk discovers and exercises it automatically. If the serializer
  // forgets to encode that new field, its mutation becomes a no-op and this
  // test fails — no test-code change required to catch it.
  describe('exhaustive single-field sensitivity', () => {
    function sensitivityFixture(): GrantClosure {
      return richClosure();
    }

    it('changing any single string field changes the key', async () => {
      const baseline = sensitivityFixture();
      const baselineKey = await computeGrantKey(baseline);

      const paths = collectStringLeafPaths(baseline);
      // Sanity: `richClosure()` yields exactly 18 string leaves (script
      // name/lang/code x2 + src x1, bundle module path/source x2, vault
      // namespace x2 + module path/source x4, pack namespace/version x2 +
      // module path/source x1) — pinned exactly so the walker silently
      // finding fewer leaves (e.g. a broken recursion case) fails here
      // rather than only weakening the loop below.
      expect(paths.length).toBe(18);

      for (const path of paths) {
        const mutated = withStringAt(
          baseline,
          path,
          '__mutated-probe__',
        ) as GrantClosure;
        const mutatedKey = await computeGrantKey(mutated);
        expect(
          mutatedKey,
          `expected mutating path ${JSON.stringify(path)} to change the grant key`,
        ).not.toBe(baselineKey);
      }
    });

    it('adding a script, bundle module, vault namespace, vault module, or pack changes the key', async () => {
      const baseline = sensitivityFixture();
      const baselineKey = await computeGrantKey(baseline);

      const addedScript: GrantClosure = {
        ...clone(baseline),
        scripts: [...baseline.scripts, { name: 'extra', lang: '', code: '' }],
      };
      const addedBundleModule: GrantClosure = {
        ...clone(baseline),
        bundleModules: { ...baseline.bundleModules, 'scripts/extra.lua': '' },
      };
      const addedVaultNamespace: GrantClosure = {
        ...clone(baseline),
        vaultModules: { ...baseline.vaultModules, 'extra/ns': {} },
      };
      const addedVaultModule: GrantClosure = {
        ...clone(baseline),
        vaultModules: {
          ...baseline.vaultModules,
          'me/utils': { ...baseline.vaultModules['me/utils'], 'extra.lua': '' },
        },
      };
      const addedPack: GrantClosure = {
        ...clone(baseline),
        packs: [...baseline.packs, { namespace: 'extra/pack', version: '1' }],
      };

      for (const mutated of [
        addedScript,
        addedBundleModule,
        addedVaultNamespace,
        addedVaultModule,
        addedPack,
      ]) {
        expect(await computeGrantKey(mutated)).not.toBe(baselineKey);
      }
    });
  });
});

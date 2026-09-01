import {
  buildDirectiveListing,
  createDocViewSource,
  DEFAULT_DOC_LISTING_LIMITS,
  type DocView,
} from '@markii/runtime';
import { describe, expect, it } from 'vitest';
import type { ScriptLimits } from './limits';
import { runScript, type RunScriptOptions } from './sandbox';

/**
 * Executed adversarial probe suite for the `doc` table (GitHub issue #33),
 * committed as product code per AGENTS.md. Every case here runs against
 * the REAL wasmoon interpreter through `runScript` end to end, never a
 * mock of the VM, and every case is a property a reader of the design
 * would want demonstrated rather than asserted:
 *
 * - hostile note content (a NUL byte, an unpaired surrogate, a megabyte of
 *   text, a thousand levels of nesting, an attribute named `__proto__`)
 *   reaches Lua as ordinary, bounded strings, or does not reach it at all;
 * - the caps are enforced where they are documented, and being over one is
 *   reported as `doc.truncated`, never raised as an error;
 * - the table is inert: writing to it, or to anything it hands back,
 *   changes nothing for the next call or the next script;
 * - reading a script that runs later fails, cleanly, as a script error
 *   rather than as a permission problem;
 * - `doc` exposes the three documented names and nothing else, adds no
 *   private residue to the globals table, and grants no reach into the
 *   host.
 *
 * Notes are built as trees, not parsed: `@markii/lua` must not depend on
 * `@markii/core` (AGENTS.md's import rule, enforced by ESLint). Building
 * them by hand is also the stronger probe here, since it reaches the
 * listing builder with content a CommonMark parser would have cleaned up
 * on the way through.
 */

interface TreeNode {
  type: string;
  name?: string;
  attributes?: Record<string, string>;
  value?: string;
  children?: TreeNode[];
}

function body(text: string): TreeNode[] {
  return text === ''
    ? []
    : [{ type: 'paragraph', children: [{ type: 'text', value: text }] }];
}

function leaf(
  name: string,
  attributes: Record<string, string> = {},
  text = '',
): TreeNode {
  return { type: 'leafDirective', name, attributes, children: body(text) };
}

function container(
  name: string,
  attributes: Record<string, string> = {},
  text = '',
): TreeNode {
  return { type: 'containerDirective', name, attributes, children: body(text) };
}

function root(children: TreeNode[]): TreeNode {
  return { type: 'root', children };
}

const FAST_LIMITS: Partial<ScriptLimits> = {
  maxInstructions: 5_000_000,
  wallClockMs: 2_000,
  hookIntervalInstructions: 5_000,
};

async function run(code: string, options: Partial<RunScriptOptions> = {}) {
  return runScript({ code, tier: 'manual', limits: FAST_LIMITS, ...options });
}

/** A `DocView` over `note`, for the script at `index` of a note whose script names are `scriptNames`. */
function docFor(
  note: TreeNode,
  options: {
    scriptNames?: string[];
    index?: number;
    completed?: Record<string, unknown>;
    limits?: Partial<typeof DEFAULT_DOC_LISTING_LIMITS>;
  } = {},
): DocView {
  const source = createDocViewSource({
    directives: buildDirectiveListing(note, options.limits ?? {}),
    scriptNames: options.scriptNames ?? ['only'],
  });
  for (const [name, value] of Object.entries(options.completed ?? {})) {
    source.recordCompleted(name, value);
  }
  return source.viewFor(options.index ?? 0);
}

/** A one-directive note, for the cases that only need `doc` wired to something. */
const SIMPLE = root([leaf('x', { a: '1' })]);

describe('doc probe — hostile note content', () => {
  it('a NUL byte is dropped, and every directive after it still arrives', async () => {
    // The one with teeth. wasmoon truncates a JS string at its first NUL
    // on the way into Lua, so an unsanitized NUL in one directive would
    // cut the JSON payload short and take the whole rest of the listing
    // with it. (A NUL typed into a note never gets this far: CommonMark
    // replaces it while parsing. A tree from anywhere else can carry one.)
    const note = root([
      leaf('first', { a: 'be\u0000fore' }, 'te\u0000xt'),
      leaf('second'),
      leaf('third'),
    ]);
    const result = await run(
      `local d = doc.directives()
       return { n = #d, text = d[1].text, a = d[1].attributes.a, last = d[#d].name }`,
      { doc: docFor(note) },
    );
    expect(result).toEqual({
      ok: true,
      value: { n: 3, text: 'text', a: 'before', last: 'third' },
    });
  });

  it('an unpaired surrogate arrives as the replacement character, not as broken bytes', async () => {
    const result = await run('return doc.directives()[1].text', {
      doc: docFor(root([container('x', {}, 'bad \ud800 end')])),
    });
    expect(result).toEqual({ ok: true, value: 'bad \uFFFD end' });
  });

  it('a real astral character survives the round trip intact', async () => {
    const result = await run('return doc.directives()[1].text', {
      doc: docFor(root([container('x', {}, 'emoji \u{1F600} kept')])),
    });
    expect(result).toEqual({ ok: true, value: 'emoji \u{1F600} kept' });
  });

  it('a megabyte of directive text is cut to the cap and reported as truncated', async () => {
    const note = root([container('big', {}, 'x'.repeat(1_000_000))]);
    const result = await run(
      'return { len = #doc.directives()[1].text, truncated = doc.truncated }',
      { doc: docFor(note) },
    );
    expect(result).toEqual({
      ok: true,
      value: { len: DEFAULT_DOC_LISTING_LIMITS.maxTextBytes, truncated: true },
    });
  });

  it('a note of thousands of directives stops at the caps rather than growing without bound', async () => {
    const note = root(
      Array.from({ length: 5_000 }, (_, i) => leaf('d', { n: String(i) })),
    );
    const result = await run(
      'return { n = #doc.directives(), truncated = doc.truncated }',
      { doc: docFor(note) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as { n: number; truncated: boolean };
      expect(value.n).toBeLessThanOrEqual(
        DEFAULT_DOC_LISTING_LIMITS.maxDirectives,
      );
      expect(value.truncated).toBe(true);
    }
  });

  it('a thousand levels of nesting produce a listing, not a stack overflow', async () => {
    let node: TreeNode = leaf('deep');
    for (let i = 0; i < 1_000; i++) {
      node = { type: 'blockquote', children: [node] };
    }
    const result = await run(
      'return { n = #doc.directives(), truncated = doc.truncated }',
      { doc: docFor(root([node])) },
    );
    // Deeper than the depth cap, so the directive is not listed and the
    // listing says so. The point is that this returns at all.
    expect(result).toEqual({ ok: true, value: { n: 0, truncated: true } });
  });

  it('a directive just inside the depth cap is still listed', async () => {
    let node: TreeNode = leaf('deep');
    for (let i = 0; i < 20; i++) {
      node = { type: 'blockquote', children: [node] };
    }
    const result = await run('return doc.directives()[1].name', {
      doc: docFor(root([node])),
    });
    expect(result).toEqual({ ok: true, value: 'deep' });
  });

  it('an attribute named __proto__ or constructor is an ordinary Lua key', async () => {
    const attributes: Record<string, string> = { constructor: 'also' };
    // Written with defineProperty: `__proto__` in an object literal sets
    // the prototype instead of creating the key this case is about.
    Object.defineProperty(attributes, '__proto__', {
      value: 'polluted',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const result = await run(
      `local a = doc.directives()[1].attributes
       return { c = a.constructor, p = a.__proto__, t = type(a) }`,
      { doc: docFor(root([leaf('x', attributes)])) },
    );
    expect(result).toEqual({
      ok: true,
      value: { c: 'also', p: 'polluted', t: 'table' },
    });
  });

  it('an attribute value cannot inject Lua: it stays a string', async () => {
    const hostile = `"] = os.exit; local y = {["`;
    const result = await run(
      `local a = doc.directives()[1].attributes.a
       return { t = type(a), same = (a == ${JSON.stringify(hostile)}), os = tostring(os) }`,
      { doc: docFor(root([leaf('x', { a: hostile })])) },
    );
    expect(result).toEqual({
      ok: true,
      value: { t: 'string', same: true, os: 'nil' },
    });
  });

  it('directive text that looks like Lua source is text, not code', async () => {
    const hostile = 'return os.exit() --[[';
    const result = await run(
      `return doc.directives()[1].text == ${JSON.stringify(hostile)}`,
      { doc: docFor(root([container('x', {}, hostile)])) },
    );
    expect(result).toEqual({ ok: true, value: true });
  });

  it('a directive name that looks like a Lua keyword is just a name', async () => {
    const result = await run(
      'return doc.directives()[1].name .. "|" .. doc.directives()[2].name',
      { doc: docFor(root([leaf('end'), leaf('function')])) },
    );
    expect(result).toEqual({ ok: true, value: 'end|function' });
  });
});

describe('doc probe — the caps are enforced where they are documented', () => {
  it('a text longer than the cap is cut at a character boundary, never mid-character', async () => {
    const note = root([container('x', {}, '\u{1F600}'.repeat(200))]);
    const result = await run('return #doc.directives()[1].text % 4', {
      doc: docFor(note, { limits: { maxTextBytes: 41 } }),
    });
    // 41 bytes of 4-byte characters means 40 bytes kept, so the length is
    // divisible by 4: no half character reached Lua.
    expect(result).toEqual({ ok: true, value: 0 });
  });

  it('attributes past the cap are dropped and the listing says it was truncated', async () => {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < 60; i++) attributes[`a${i}`] = 'v';
    const result = await run(
      `local a = doc.directives()[1].attributes
       local n = 0
       for _ in pairs(a) do n = n + 1 end
       return { n = n, truncated = doc.truncated }`,
      { doc: docFor(root([leaf('x', attributes)])) },
    );
    expect(result).toEqual({
      ok: true,
      value: { n: DEFAULT_DOC_LISTING_LIMITS.maxAttributes, truncated: true },
    });
  });

  it('being over a cap is never an error: the script still runs and still gets a list', async () => {
    const note = root(
      Array.from({ length: 200 }, () => container('q', {}, 'y'.repeat(5_000))),
    );
    // The sandbox's own default instruction budget, not this suite's small
    // one: decoding a listing at the 512 KiB cap is real Lua work, and the
    // point here is that it COMPLETES rather than that it is cheap.
    const result = await run(
      `local ok = pcall(doc.directives)
       return { ok = ok, n = #doc.directives(), truncated = doc.truncated }`,
      { doc: docFor(note), limits: { wallClockMs: 10_000 } },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as {
        ok: boolean;
        n: number;
        truncated: boolean;
      };
      expect(value.ok).toBe(true);
      expect(value.n).toBeGreaterThan(0);
      expect(value.truncated).toBe(true);
    }
  });

  it('a bound value bigger than the marshal budget is refused, not silently trimmed', async () => {
    // Deeper than the default 32-level depth cap the marshal walk uses.
    let deep: unknown = 1;
    for (let i = 0; i < 80; i++) deep = { next: deep };
    const result = await run('return doc.value("deep")', {
      doc: docFor(SIMPLE, {
        scriptNames: ['deep', 'reader'],
        index: 1,
        completed: { deep },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toContain('doc.value("deep")');
    }
  });
});

describe('doc probe — the table is inert', () => {
  const note = root([container('q', { a: '1' }, 'original')]);

  it('writing to an entry does not change what the next call returns', async () => {
    const result = await run(
      `local first = doc.directives()[1]
       first.text = "tampered"
       first.attributes.a = "tampered"
       first.name = "tampered"
       local second = doc.directives()[1]
       return { text = second.text, a = second.attributes.a, name = second.name }`,
      { doc: docFor(note) },
    );
    expect(result).toEqual({
      ok: true,
      value: { text: 'original', a: '1', name: 'q' },
    });
  });

  it('replacing doc.directives itself does not survive into the next script', async () => {
    const doc = docFor(note);
    const first = await run(
      `doc.directives = function() return {} end
       doc.value = function() return "forged" end
       doc.truncated = true
       return #doc.directives()`,
      { doc },
    );
    expect(first).toEqual({ ok: true, value: 0 });

    // A second run with the SAME view: each script gets its own engine, so
    // nothing the first one rewrote is visible here.
    const second = await run(
      'return { n = #doc.directives(), truncated = doc.truncated }',
      { doc },
    );
    expect(second).toEqual({ ok: true, value: { n: 1, truncated: false } });
  });

  it('rebinding the decoder before calling doc.directives cannot change what it returns', async () => {
    const result = await run(
      `__smd_json_decode = function() return { { name = "forged" } } end
       return doc.directives()[1].name`,
      { doc: docFor(note) },
    );
    expect(result).toEqual({ ok: true, value: 'q' });
  });

  it('rebinding type or error cannot disable the filter guards', async () => {
    const result = await run(
      `type = function() return "table" end
       error = function() end
       local ok = pcall(function() return doc.directives("not a table") end)
       return ok`,
      { doc: docFor(note) },
    );
    expect(result).toEqual({ ok: true, value: false });
  });

  it('leaves no private sandbox name behind: the decoder global is put back as it was', async () => {
    // `doc` is wired for EVERY run, and its prelude needs the same in-Lua
    // JSON decoder `net.fetch_json` uses. Defining that decoder must not
    // leave `__smd_json_decode` reachable from user code in a run that
    // wires no net and no cache (see `require-pass3.probe.test.ts`, which
    // fails the suite for exactly this class of residue).
    const result = await run(
      `local found = {}
       for name in pairs(_ENV) do
         if string.sub(name, 1, 6) == "__smd_" and name ~= "__smd_marshal_root" then
           found[#found + 1] = name
         end
       end
       table.sort(found)
       return table.concat(found, ",")`,
      { doc: docFor(note) },
    );
    expect(result).toEqual({ ok: true, value: '' });
  });

  it('the raw host handles are gone by the time a script runs', async () => {
    const result = await run(
      'return tostring(__smd_doc_listing_raw) .. "," .. tostring(__smd_doc_value_raw)',
      { doc: docFor(note) },
    );
    expect(result).toEqual({ ok: true, value: 'nil,nil' });
  });
});

describe('doc probe — reading a script that runs later', () => {
  it('fails the run, as a script error and never as a capability denial', async () => {
    const result = await run('return doc.value("later")', {
      doc: docFor(SIMPLE, { scriptNames: ['reader', 'later'], index: 0 }),
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'runtime',
        message: 'reads "later", which runs later in the note',
      },
    });
  });

  it('reports the clean sentence even when the script fails for its own reason afterwards', async () => {
    const result = await run(
      `local ok, err = pcall(doc.value, "later")
       error("something else entirely")`,
      { doc: docFor(SIMPLE, { scriptNames: ['reader', 'later'], index: 0 }) },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'runtime',
        message: 'reads "later", which runs later in the note',
      },
    });
  });

  it('cannot be forged: a script raising the same sentence is an ordinary runtime error', async () => {
    const result = await run(
      'error("reads \\"nothing\\", which runs later in the note")',
      { doc: docFor(SIMPLE, { scriptNames: ['only'], index: 0 }) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The forged text comes back Lua-wrapped, with the chunk position
      // and traceback the real one never carries, because the real one is
      // read off the host-side record instead.
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toContain('stack traceback');
    }
  });

  it('a caught refusal followed by a successful return still succeeds', async () => {
    const result = await run(
      `local ok = pcall(doc.value, "later")
       return ok`,
      { doc: docFor(SIMPLE, { scriptNames: ['reader', 'later'], index: 0 }) },
    );
    expect(result).toEqual({ ok: true, value: false });
  });
});

describe('doc probe — nothing beyond the three documented names', () => {
  it('the doc table holds exactly directives, value and truncated', async () => {
    const result = await run(
      `local keys = {}
       for key in pairs(doc) do keys[#keys + 1] = key end
       table.sort(keys)
       return table.concat(keys, ",")`,
      { doc: docFor(SIMPLE) },
    );
    expect(result).toEqual({ ok: true, value: 'directives,truncated,value' });
  });

  it('an entry holds exactly the four documented fields', async () => {
    const result = await run(
      `local keys = {}
       for key in pairs(doc.directives()[1]) do keys[#keys + 1] = key end
       table.sort(keys)
       return table.concat(keys, ",")`,
      { doc: docFor(SIMPLE) },
    );
    expect(result).toEqual({ ok: true, value: 'attributes,form,name,text' });
  });

  it('there is no metatable machinery in the sandbox to reach through it with', async () => {
    const result = await run(
      `return tostring(getmetatable) .. "," .. tostring(setmetatable) ..
       "," .. tostring(rawget) .. "," .. tostring(rawset)`,
      { doc: docFor(SIMPLE) },
    );
    expect(result).toEqual({ ok: true, value: 'nil,nil,nil,nil' });
  });

  it('doc.directives is a Lua function, not a bridged host object', async () => {
    const result = await run(
      'return type(doc.directives) .. "," .. type(doc.value) .. "," .. type(doc)',
      { doc: docFor(SIMPLE) },
    );
    expect(result).toEqual({ ok: true, value: 'function,function,table' });
  });

  it('an entry is a plain table a script can return as its own value', async () => {
    const result = await run('return doc.directives()[1]', {
      doc: docFor(SIMPLE),
    });
    expect(result).toEqual({
      ok: true,
      value: { name: 'x', form: 'leaf', attributes: { a: '1' }, text: '' },
    });
  });

  it('the note reaches Lua with no clock, no host and no file behind it', async () => {
    const result = await run(
      `return tostring(os) .. "," .. tostring(io) .. "," .. tostring(net) ..
       "," .. tostring(bundle) .. "," .. tostring(cache)`,
      { doc: docFor(SIMPLE) },
    );
    expect(result).toEqual({ ok: true, value: 'nil,nil,nil,nil,nil' });
  });
});

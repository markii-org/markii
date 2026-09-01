import {
  buildDirectiveListing,
  createDocViewSource,
  type DirectiveListing,
  type DocView,
} from '@markii/runtime';
import { describe, expect, it } from 'vitest';
import type { ScriptLimits } from './limits';
import { runScript, type RunScriptOptions } from './sandbox';

/**
 * Behavioral tests for the `doc` table (`./doc`, GitHub issue #33), run
 * through the real sandbox.
 *
 * Notes are built as trees here rather than parsed: `@markii/lua` must not
 * depend on `@markii/core` (AGENTS.md's import rule, enforced by ESLint),
 * and the listing builder takes a tree, not text. What a real parser
 * produces for these same directives is covered where it belongs, in
 * `@markii/runtime`'s `doc.test.ts`.
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

function directive(
  type: 'leafDirective' | 'containerDirective' | 'textDirective',
  name: string,
  attributes: Record<string, string> = {},
  text = '',
): TreeNode {
  return { type, name, attributes, children: body(text) };
}

function root(children: TreeNode[]): TreeNode {
  return { type: 'root', children };
}

/** The note every test below reads unless it supplies its own. */
const NOTE = root([
  { type: 'heading', children: [{ type: 'text', value: 'Revision' }] },
  directive(
    'containerDirective',
    'prep_q',
    { q: 'What can a bloom filter get wrong?', level: 'easy', topic: 'ds' },
    'A false positive, never a false negative.',
  ),
  directive(
    'containerDirective',
    'prep_q',
    { q: 'Why a skip list?', level: 'medium' },
    'Expected O(log n) with simpler code.',
  ),
  directive('leafDirective', 'prep_topic', { confidence: '4' }, 'Graphs'),
  {
    type: 'paragraph',
    children: [
      { type: 'text', value: 'An ' },
      directive('textDirective', 'kbd', {}, 'Esc'),
      { type: 'text', value: ' key inline.' },
    ],
  },
]);

/** Small limits so this whole suite runs in milliseconds, matching `sandbox.test.ts`. */
const FAST_LIMITS: Partial<ScriptLimits> = {
  maxInstructions: 2_000_000,
  wallClockMs: 500,
  hookIntervalInstructions: 5_000,
};

function listing(note: TreeNode = NOTE): DirectiveListing {
  return buildDirectiveListing(note);
}

/** A `DocView` for the script at `index`, with `completed` already recorded above it. */
function viewFor(options: {
  note?: TreeNode;
  scriptNames?: string[];
  index?: number;
  completed?: Record<string, unknown>;
}): DocView {
  const source = createDocViewSource({
    directives: listing(options.note ?? NOTE),
    scriptNames: options.scriptNames ?? ['only'],
  });
  for (const [name, value] of Object.entries(options.completed ?? {})) {
    source.recordCompleted(name, value);
  }
  return source.viewFor(options.index ?? 0);
}

async function run(code: string, overrides: Partial<RunScriptOptions> = {}) {
  return runScript({
    code,
    tier: 'manual',
    limits: FAST_LIMITS,
    doc: viewFor({}),
    ...overrides,
  });
}

describe('doc.directives', () => {
  it('lists the note in document order, as genuine Lua tables', async () => {
    const result = await run(`
      local out = {}
      for i, d in ipairs(doc.directives()) do
        out[i] = d.name .. ":" .. d.form
      end
      return { types = type(doc.directives()), list = out }
    `);
    expect(result).toEqual({
      ok: true,
      value: {
        types: 'table',
        list: [
          'prep_q:container',
          'prep_q:container',
          'prep_topic:leaf',
          'kbd:inline',
        ],
      },
    });
  });

  it('carries attributes and stripped text on each entry', async () => {
    const result = await run(`
      local first = doc.directives()[1]
      return { q = first.attributes.q, level = first.attributes.level, text = first.text }
    `);
    expect(result).toEqual({
      ok: true,
      value: {
        q: 'What can a bloom filter get wrong?',
        level: 'easy',
        text: 'A false positive, never a false negative.',
      },
    });
  });

  it('filters by name with the table-call form the docs use', async () => {
    const result = await run(`
      local qs = doc.directives{ name = "prep_q" }
      local levels = {}
      for i, q in ipairs(qs) do levels[i] = q.attributes.level end
      return levels
    `);
    expect(result).toEqual({ ok: true, value: ['easy', 'medium'] });
  });

  it('returns an empty list for a name the note does not use', async () => {
    const result = await run('return #doc.directives{ name = "nothing" }');
    expect(result).toEqual({ ok: true, value: 0 });
  });

  it('reports truncation on the table, and says false for a whole note', async () => {
    const result = await run('return doc.truncated');
    expect(result).toEqual({ ok: true, value: false });

    const truncated = await run('return doc.truncated', {
      doc: {
        directives: buildDirectiveListing(NOTE, { maxDirectives: 1 }),
        value: () => ({ ok: true, value: undefined }),
      },
    });
    expect(truncated).toEqual({ ok: true, value: true });
  });

  it('exposes exactly three names on the doc table and nothing else', async () => {
    const result = await run(`
      local keys = {}
      for key in pairs(doc) do keys[#keys + 1] = key end
      table.sort(keys)
      return table.concat(keys, ",")
    `);
    expect(result).toEqual({ ok: true, value: 'directives,truncated,value' });
  });

  it('is defined even for a run wired with no note at all', async () => {
    const result = await run(
      'return { n = #doc.directives(), v = doc.value("anything"), t = doc.truncated }',
      { doc: undefined },
    );
    expect(result).toEqual({ ok: true, value: { n: 0, t: false } });
  });

  it('rejects a filter that is not a table, and a name that is not a string', async () => {
    const notTable = await run('return doc.directives("prep_q")');
    expect(notTable.ok).toBe(false);
    const notString = await run('return doc.directives{ name = 7 }');
    expect(notString.ok).toBe(false);
  });
});

describe('doc.value', () => {
  it('reads a value a script above already produced', async () => {
    const result = await run('return doc.value("counts").total', {
      doc: viewFor({
        scriptNames: ['counts', 'reader'],
        index: 1,
        completed: { counts: { total: 12 } },
      }),
    });
    expect(result).toEqual({ ok: true, value: 12 });
  });

  it('reads a scalar value as a scalar', async () => {
    const result = await run(
      'return { n = doc.value("n"), s = doc.value("s"), b = doc.value("b") }',
      {
        doc: viewFor({
          scriptNames: ['n', 's', 'b', 'reader'],
          index: 3,
          completed: { n: 5, s: 'text', b: true },
        }),
      },
    );
    expect(result).toEqual({ ok: true, value: { n: 5, s: 'text', b: true } });
  });

  it('answers nil for an unknown name', async () => {
    const result = await run('return doc.value("nothing") == nil');
    expect(result).toEqual({ ok: true, value: true });
  });

  it('answers nil for a script above that failed', async () => {
    const result = await run('return doc.value("broken") == nil', {
      doc: viewFor({
        scriptNames: ['broken', 'reader'],
        index: 1,
        completed: { broken: undefined },
      }),
    });
    expect(result).toEqual({ ok: true, value: true });
  });

  it('fails the run when it reads a script that runs later, with the shared sentence', async () => {
    const result = await run('return doc.value("later")', {
      doc: viewFor({ scriptNames: ['reader', 'later'], index: 0 }),
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'runtime',
        message: 'reads "later", which runs later in the note',
      },
    });
  });

  it('fails the same way for a script reading its own name', async () => {
    const result = await run('return doc.value("self")', {
      doc: viewFor({ scriptNames: ['self'], index: 0 }),
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'runtime',
        message: 'reads "self", which runs later in the note',
      },
    });
  });

  it('rejects a non-string name', async () => {
    const result = await run('return doc.value(7)');
    expect(result.ok).toBe(false);
  });
});

describe('the doc table needs no grant and no tier', () => {
  it('works identically under the read-only auto tier', async () => {
    const manual = await run('return #doc.directives{ name = "prep_q" }', {
      tier: 'manual',
    });
    const auto = await run('return #doc.directives{ name = "prep_q" }', {
      tier: 'auto',
    });
    expect(manual).toEqual({ ok: true, value: 2 });
    expect(auto).toEqual(manual);
  });

  it('reads a value under auto exactly as under manual', async () => {
    const doc = viewFor({
      scriptNames: ['above', 'reader'],
      index: 1,
      completed: { above: 'ok' },
    });
    expect(
      await run('return doc.value("above")', { tier: 'auto', doc }),
    ).toEqual({ ok: true, value: 'ok' });
  });

  it('never classifies a refused read as a capability failure', async () => {
    const result = await run('return doc.value("later")', {
      tier: 'auto',
      doc: viewFor({ scriptNames: ['reader', 'later'], index: 0 }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('runtime');
      expect(result.error.kind).not.toBe('capability');
    }
  });
});

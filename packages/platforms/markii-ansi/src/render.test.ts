import { describe, expect, it } from 'vitest';
import { createValueStore, createVaultStore } from '@markii/runtime';
import {
  renderMarkToAnsi,
  renderMarkNodeToAnsi,
  renderMarkInlineToAnsi,
} from './render.js';
import {
  childrenText,
  createAnsiRegistry,
  type AnsiComponent,
  type AnsiRegistry,
} from './registry.js';
import { stripEscapes } from './text-grid.js';

/**
 * Whether `line` leaves NO SGR attribute open at its own end — i.e. every
 * "turn on" code (1 bold, 4 underline) it contains is matched by a later
 * "turn off" code (its own narrow off-code, or a full reset). Ink
 * normalizes a full reset to the narrower off-codes it determines are
 * actually needed (confirmed by inspecting real output), so this checks
 * the SEMANTIC invariant `carrySgrAcrossLines` exists to guarantee, not one
 * exact byte form.
 */
function hasNoDanglingSgr(line: string): boolean {
  const OFF_FOR: Record<string, string> = { '1': '22', '4': '24' };
  const open = new Set<string>();
  for (const match of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
    const params = match[1] ?? '';
    if (params === '' || params === '0') {
      open.clear();
      continue;
    }
    for (const code of params.split(';')) {
      if (code in OFF_FOR) open.add(code);
      else if (Object.values(OFF_FOR).includes(code)) {
        const onCode = Object.keys(OFF_FOR).find((k) => OFF_FOR[k] === code);
        if (onCode) open.delete(onCode);
      }
    }
  }
  return open.size === 0;
}

const empty = createAnsiRegistry();

const callout: AnsiComponent = ({ attributes, children, ctx }) => {
  const type = typeof attributes.type === 'string' ? attributes.type : 'note';
  return `[${type}] ${ctx.text(childrenText(children))}`;
};

const badge: AnsiComponent = ({ children }) => `[${childrenText(children)}]`;

const withComponents: AnsiRegistry = createAnsiRegistry(
  {
    callout: { component: callout },
    badge: { component: badge, inline: true },
  },
  { warn: { name: 'callout', attributes: { type: 'warning' } } },
);

describe('plain markdown renders to wrapped, styled plain text', () => {
  it('renders headings, emphasis, lists, and code', async () => {
    const text = await renderMarkToAnsi(
      '# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n',
      empty,
    );
    const plain = stripEscapes(text);
    expect(plain).toContain('Title');
    expect(plain).toContain('bold');
    expect(plain).toContain('code');
    expect(plain).toContain('- one');
    expect(plain).toContain('- two');
  });

  it('is a pure function: identical input yields identical output', async () => {
    const src = '# H\n\n:::callout\nhi\n:::\n';
    expect(await renderMarkToAnsi(src, withComponents)).toBe(
      await renderMarkToAnsi(src, withComponents),
    );
  });

  it('output uses \\n line endings only and ends in exactly one newline', async () => {
    const text = await renderMarkToAnsi('one\n\ntwo\n\n\n', empty);
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('wraps a long paragraph to the given width', async () => {
    const text = await renderMarkToAnsi(
      'one two three four five six seven eight\n',
      empty,
      undefined,
      undefined,
      {
        width: 10,
      },
    );
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it("a level-1 heading long enough to wrap keeps its underline+bold styling on every resulting line (Ink resets SGR state at each embedded line boundary; see ansi.test.ts's carrySgrAcrossLines suite)", async () => {
    const text = await renderMarkToAnsi(
      '# one two three four five six seven eight nine ten\n',
      empty,
      undefined,
      undefined,
      { width: 10, color: 'truecolor' },
    );
    const lines = text.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      // Every line opens its own styling from the start...
      expect(line).toMatch(/^\x1b\[4m\x1b\[1m/);
      // ...and is already fully self-contained: passing an ALREADY-repaired
      // line back through `carrySgrAcrossLines` changes nothing, since
      // there is no `\n` inside a single line for it to act on, and the
      // line itself carries no dangling open state past its own end (Ink
      // may normalize the close to its own minimal equivalent, e.g.
      // `\x1b[22m\x1b[24m` instead of a bare `\x1b[0m` — both are "fully
      // closed", so this checks the INVARIANT, not one exact byte form).
      expect(hasNoDanglingSgr(line)).toBe(true);
    }
  });

  it('a paragraph with a bold span that straddles a wrap point never lets styling bleed into the next line', async () => {
    const text = await renderMarkToAnsi(
      'plain words before the **bold phrase that continues on** after\n',
      empty,
      undefined,
      undefined,
      { width: 20, color: 'truecolor' },
    );
    const lines = text.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(hasNoDanglingSgr(line)).toBe(true);
    }
  });
});

describe('unknown-directive fallback', () => {
  it('renders a dashed dim frame naming the component, keeping inner content', async () => {
    const text = await renderMarkToAnsi(':::mystery\nkept body\n:::\n', empty);
    const plain = stripEscapes(text);
    expect(plain).toContain('unknown component `mystery`');
    expect(plain).toContain('kept body');
    expect(plain).toContain('┌');
    expect(plain).toContain('└');
  });

  it('renders an inline directive fallback inline, never a framed box', async () => {
    const text = await renderMarkToAnsi('before :ghost[label] after\n', empty);
    const plain = stripEscapes(text);
    // The label and the passed-through content are separated by a colon:
    // a terminal has no styling a reader can count on at color level
    // `'none'`, so without it the label runs into the author's words.
    expect(plain).toContain('unknown component `ghost`: label');
    expect(plain).not.toContain('┌');
  });

  it('omits the separator when an inline fallback has no content to separate', async () => {
    const plain = stripEscapes(
      await renderMarkToAnsi('before :ghost after\n', empty),
    );
    expect(plain).toContain('unknown component `ghost`');
    expect(plain).not.toContain('`ghost`:');
  });
});

describe('registered components', () => {
  it('receives already-rendered children and its own attributes', async () => {
    const text = await renderMarkToAnsi(
      ':::callout{type=info}\n**hi** there\n:::\n',
      withComponents,
    );
    expect(stripEscapes(text)).toContain('[info] hi there');
  });

  it('resolves an alias, with the alias preset reaching the component', async () => {
    const text = await renderMarkToAnsi(
      ':::warn\nheads up\n:::\n',
      withComponents,
    );
    expect(stripEscapes(text)).toContain('[warning] heads up');
  });

  it('a registered alias never shadows a real component of the same name', async () => {
    const reg = createAnsiRegistry(
      { callout: { component: callout } },
      { callout: { name: 'badge' } },
    );
    const text = await renderMarkToAnsi(':::callout\nx\n:::\n', reg);
    expect(stripEscapes(text)).toContain('[note] x');
  });
});

describe('form/kind mismatch', () => {
  it('a block-only component written inline degrades to the inline fallback', async () => {
    const reg = createAnsiRegistry({
      panel: { component: callout, inline: false },
    });
    const text = await renderMarkToAnsi('see :panel[x] here\n', reg);
    expect(stripEscapes(text)).toContain(
      'block component `panel` written inline',
    );
  });

  it('an inline component written as a block is permitted (no degrade)', async () => {
    const text = await renderMarkToAnsi(
      ':::badge\ncontent\n:::\n',
      withComponents,
    );
    expect(stripEscapes(text)).toContain('[content]');
  });
});

describe('layout presets (width/align)', () => {
  it('strips width/align from the attributes a component sees', async () => {
    const seen: string[] = [];
    const probe: AnsiComponent = ({ attributes, children }) => {
      seen.push(JSON.stringify(attributes));
      return children;
    };
    const reg = createAnsiRegistry({ box: { component: probe } });
    await renderMarkToAnsi(':::box{width=wide align=center}\nx\n:::\n', reg);
    expect(seen[0]).toBe('{}');
  });

  it('never applies layout to an inline directive, and drops invalid values silently', async () => {
    const text = await renderMarkToAnsi(
      'a :badge[x]{width=huge} b\n',
      withComponents,
    );
    expect(stripEscapes(text)).toContain('[x]');
  });
});

describe('hostile directive names never throw', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    it(`a directive named ${name} renders the fallback, not a prototype member`, async () => {
      const text = await renderMarkToAnsi(
        `:::${name}\nbody\n:::\n`,
        withComponents,
      );
      expect(stripEscapes(text)).toContain(`unknown component \`${name}\``);
    });
  }
});

describe('script-fence folding', () => {
  it('folds a {name=...} fence into a one-line collapsed marker', async () => {
    const text = await renderMarkToAnsi(
      '```lua {name=stars}\nreturn 1\n```\n',
      empty,
    );
    const plain = stripEscapes(text);
    expect(plain).toContain('⚙ stars · lua');
    expect(plain).not.toContain('return 1');
  });

  it('shows a src= reference detail', async () => {
    const text = await renderMarkToAnsi(
      '```lua {name=s src=scripts/etl.lua}\n\n```\n',
      empty,
    );
    expect(stripEscapes(text)).toContain('⚙ s · scripts/etl.lua');
  });

  it('a fence whose name is invalid (a dot) stays an ordinary code block', async () => {
    const text = await renderMarkToAnsi('```lua {name=a.b}\nx\n```\n', empty);
    const plain = stripEscapes(text);
    expect(plain).not.toContain('⚙');
    expect(plain).toContain('x');
  });

  it('a plain fence with no name stays an ordinary code block', async () => {
    const text = await renderMarkToAnsi('```js\nconsole.log(1)\n```\n', empty);
    const plain = stripEscapes(text);
    expect(plain).not.toContain('⚙');
    expect(plain).toContain('console.log(1)');
  });
});

describe('a throwing component is contained, never fails the document', () => {
  it('renders a component-error box and still renders siblings', async () => {
    const boom: AnsiComponent = () => {
      throw new Error('kaboom');
    };
    const reg = createAnsiRegistry({ boom: { component: boom } });
    const text = await renderMarkToAnsi(
      '# heading\n\n:::boom\nx\n:::\n\nafter\n',
      reg,
    );
    const plain = stripEscapes(text);
    expect(plain).toContain('component `boom` failed to render');
    expect(plain).not.toContain('kaboom');
    expect(plain).toContain('heading');
    expect(plain).toContain('after');
  });
});

describe(':value[...] built-in', () => {
  it('renders the missing marker with the name in braces (no store)', async () => {
    const text = await renderMarkToAnsi('stars: :value[repo.stars]\n', empty);
    expect(stripEscapes(text)).toContain('stars: {repo.stars}');
  });

  it('renders the resolved value from a store', async () => {
    const store = createValueStore({ stars: { value: 42, status: 'fresh' } });
    const text = await renderMarkToAnsi('stars: :value[stars]\n', empty, store);
    expect(stripEscapes(text)).toContain('stars: 42');
  });

  it('walks a dotted path into a stored object', async () => {
    const store = createValueStore({
      repo: { value: { stars: 7 }, status: 'fresh' },
    });
    const text = await renderMarkToAnsi(
      'stars: :value[repo.stars]\n',
      empty,
      store,
    );
    expect(stripEscapes(text)).toContain('stars: 7');
  });

  it('a stale value gets the stale suffix', async () => {
    const store = createValueStore({ stars: { value: 1, status: 'stale' } });
    const text = await renderMarkToAnsi(':value[stars]\n', empty, store);
    expect(stripEscapes(text)).toContain('1 (stale)');
  });

  it('an error status shows the failure phrase', async () => {
    const store = createValueStore({
      stars: {
        value: undefined,
        status: 'error',
        error: 'boom',
        failureKind: 'capability-denied',
      },
    });
    const text = await renderMarkToAnsi(':value[stars]\n', empty, store);
    expect(stripEscapes(text)).toContain('(needs permission)');
  });

  it('resolves an @-prefixed name against the vault', async () => {
    const { store: vault, writer } = createVaultStore();
    void writer.publish('gh', { value: 100, status: 'fresh' });
    const text = await renderMarkToAnsi(
      ':value[@gh]\n',
      empty,
      undefined,
      vault,
    );
    expect(stripEscapes(text)).toContain('100');
  });
});

describe('data= binding', () => {
  it('threads data/dataStatus onto the component context', async () => {
    const store = createValueStore({ n: { value: 5, status: 'fresh' } });
    const probe: AnsiComponent = ({ ctx }) =>
      `${String(ctx.data)}:${ctx.dataStatus}`;
    const reg = createAnsiRegistry({ box: { component: probe } });
    const text = await renderMarkToAnsi(':::box{data=n}\n\n:::\n', reg, store);
    expect(stripEscapes(text)).toContain('5:fresh');
  });

  it('data*, all four, stay undefined together with no data= attribute', async () => {
    const probe: AnsiComponent = ({ ctx }) =>
      String('data' in ctx) + String(ctx.dataStatus === undefined);
    const reg = createAnsiRegistry({ box: { component: probe } });
    const text = await renderMarkToAnsi(':::box\n\n:::\n', reg);
    expect(stripEscapes(text)).toContain('falsetrue');
  });
});

describe('empty-inline and invalid-enum quiet markers', () => {
  it('an inline: true component with no content gets the empty-inline marker text', async () => {
    const text = await renderMarkToAnsi(':badge[]\n', withComponents);
    expect(stripEscapes(text)).toContain('no content');
  });

  it('an invalid enum value on a known stdlib attribute still renders, with a quiet marker and a diagnostic', async () => {
    const diagnostics: unknown[] = [];
    const passthrough: AnsiComponent = ({ attributes }) =>
      `type=${String(attributes.type)}`;
    const reg = createAnsiRegistry({ callout: { component: passthrough } });
    const text = await renderMarkToAnsi(
      ':::callout{type=bogus}\nx\n:::\n',
      reg,
      undefined,
      undefined,
      {
        onDiagnostic: (event) => diagnostics.push(event),
      },
    );
    expect(stripEscapes(text)).toContain('[callout: type ignored]');
    expect(stripEscapes(text)).not.toContain('is not a valid type value');
    expect(diagnostics).toHaveLength(1);
    expect((diagnostics[0] as { message: string }).message).toContain(
      'is not a valid type value',
    );
  });
});

describe('links and images', () => {
  it('renders a link as text plus the url when color is none', async () => {
    const text = await renderMarkToAnsi(
      '[example](https://example.com)\n',
      empty,
      undefined,
      undefined,
      {
        color: 'never',
      },
    );
    expect(text).toContain('example (https://example.com)');
  });

  it('prints the url once when the link text equals the url', async () => {
    const text = await renderMarkToAnsi(
      '<https://example.com>\n',
      empty,
      undefined,
      undefined,
      { color: 'never' },
    );
    const occurrences = text.split('https://example.com').length - 1;
    expect(occurrences).toBe(1);
  });

  it('sanitizes a javascript: link href via @markii/core, never emitting it', async () => {
    const text = await renderMarkToAnsi(
      '[click](javascript:alert(1))\n',
      empty,
    );
    expect(text).not.toContain('javascript:');
  });

  it('renders an image as [alt] (src)', async () => {
    const text = await renderMarkToAnsi('![a cat](cat.png)\n', empty);
    expect(text).toContain('[a cat] (cat.png)');
  });
});

describe('renderMarkNodeToAnsi / renderMarkInlineToAnsi', () => {
  it('renderMarkInlineToAnsi renders a lone inline directive without a paragraph wrapper', async () => {
    const text = await renderMarkInlineToAnsi(':badge[hi]', withComponents);
    expect(stripEscapes(text).trim()).toBe('[hi]');
  });

  it('renderMarkNodeToAnsi accepts a whole parsed root', async () => {
    const text = await renderMarkToAnsi('hello\n', empty);
    expect(text).toContain('hello');
    // Cross-check against the node-based entry point for the same source.
    const nodeText = await renderMarkNodeToAnsi(
      {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'hello' }] },
        ],
      } as never,
      empty,
    );
    expect(nodeText).toContain('hello');
  });
});

describe('blockquotes and lists', () => {
  it('prefixes each blockquote line with a bar', async () => {
    const text = await renderMarkToAnsi('> quoted text\n', empty);
    expect(stripEscapes(text)).toContain('│ quoted text');
  });

  it('renders a task list item with its checked state', async () => {
    const text = await renderMarkToAnsi('- [x] done\n- [ ] not done\n', empty);
    const plain = stripEscapes(text);
    expect(plain).toContain('[x] done');
    expect(plain).toContain('[ ] not done');
  });

  it('renders an ordered list honoring a start value', async () => {
    const text = await renderMarkToAnsi('3. three\n4. four\n', empty);
    const plain = stripEscapes(text);
    expect(plain).toContain('3. three');
    expect(plain).toContain('4. four');
  });
});

describe('thematic break and table', () => {
  it('renders a thematic break as a full-width rule', async () => {
    const text = await renderMarkToAnsi('---\n', empty, undefined, undefined, {
      width: 10,
    });
    const plain = stripEscapes(text).trim();
    expect(plain).toBe('─'.repeat(10));
  });

  it('renders a GFM table as a box-drawn grid with a header row', async () => {
    // Phase 2: renderTable now shares `./components/table-grid.js`'s
    // `drawTableGrid` with the data-bound `::table` component, so an
    // ordinary markdown table draws real box-drawing glyphs at the real
    // available width instead of the earlier `+---+` ASCII stopgap.
    const text = await renderMarkToAnsi(
      '| a | b |\n| - | - |\n| 1 | 2 |\n',
      empty,
    );
    const plain = stripEscapes(text);
    expect(plain).toContain('┌');
    expect(plain).toContain('a');
    expect(plain).toContain('1');
    expect(plain).toContain('└');
  });
});

describe('escaping and sanitization', () => {
  it('drops raw HTML and never emits a script tag', async () => {
    const text = await renderMarkToAnsi(
      'text\n\n<script>alert(1)</script>\n',
      empty,
    );
    expect(text).not.toContain('<script>');
  });

  it('ctx.text strips the ESC byte a component prints, so no live escape survives', async () => {
    const evil: AnsiComponent = ({ ctx }) => ctx.text('a\x1b[31mb');
    const reg = createAnsiRegistry({ evil: { component: evil } });
    const text = await renderMarkToAnsi(':::evil\n:::\n', reg);
    expect(text).not.toContain('\x1b');
    expect(text).toContain('a[31mb');
  });
});

describe('block separation', () => {
  it('separates two blocks with exactly one blank line, never a whitespace-only line between them', async () => {
    const text = await renderMarkToAnsi(
      'First paragraph.\n\nSecond paragraph.\n',
      empty,
    );
    expect(text).toBe('First paragraph.\n\nSecond paragraph.\n');
  });

  it('emits no line that is only whitespace, for a document of every block kind', async () => {
    const source = [
      '# Title',
      '',
      'A paragraph.',
      '',
      '- one',
      '- two',
      '',
      '> quoted',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '---',
      '',
      'Last.',
      '',
    ].join('\n');
    const text = await renderMarkToAnsi(source, empty, undefined, undefined, {
      width: 40,
      color: 'never',
    });
    const whitespaceOnly = text
      .split('\n')
      .filter((line) => line !== '' && line.trim() === '');
    expect(whitespaceOnly).toEqual([]);
  });

  it('a block quote carries no empty quoted lines around its paragraph', async () => {
    const text = await renderMarkToAnsi(
      '> quoted line\n',
      empty,
      undefined,
      undefined,
      {
        width: 40,
        color: 'never',
      },
    );
    expect(text).toBe('│ quoted line\n');
  });
});

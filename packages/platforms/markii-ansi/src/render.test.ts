import { describe, expect, it } from 'vitest';
import { createValueStore, createVaultStore } from '@markii/runtime';
import {
  renderMarkToAnsi,
  renderMarkNodeToAnsi,
  renderMarkInlineToAnsi,
} from './render.js';
import {
  createAnsiRegistry,
  type AnsiComponent,
  type AnsiRegistry,
} from './registry.js';
import { stripAnsi } from './measure.js';

const empty = createAnsiRegistry();

const callout: AnsiComponent = (attrs, children, ctx) => {
  const type = typeof attrs.type === 'string' ? attrs.type : 'note';
  return `[${type}] ${ctx.text(children())}`;
};

const badge: AnsiComponent = (_attrs, children) => `[${children()}]`;

const withComponents: AnsiRegistry = createAnsiRegistry(
  {
    callout: { component: callout },
    badge: { component: badge, inline: true },
  },
  { warn: { name: 'callout', attributes: { type: 'warning' } } },
);

describe('plain markdown renders to wrapped, styled plain text', () => {
  it('renders headings, emphasis, lists, and code', () => {
    const text = renderMarkToAnsi(
      '# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n',
      empty,
    );
    const plain = stripAnsi(text);
    expect(plain).toContain('Title');
    expect(plain).toContain('bold');
    expect(plain).toContain('code');
    expect(plain).toContain('- one');
    expect(plain).toContain('- two');
  });

  it('is a pure function: identical input yields identical output', () => {
    const src = '# H\n\n:::callout\nhi\n:::\n';
    expect(renderMarkToAnsi(src, withComponents)).toBe(
      renderMarkToAnsi(src, withComponents),
    );
  });

  it('output uses \\n line endings only and ends in exactly one newline', () => {
    const text = renderMarkToAnsi('one\n\ntwo\n\n\n', empty);
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('wraps a long paragraph to the given width', () => {
    const text = renderMarkToAnsi(
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
});

describe('unknown-directive fallback', () => {
  it('renders a dashed dim frame naming the component, keeping inner content', () => {
    const text = renderMarkToAnsi(':::mystery\nkept body\n:::\n', empty);
    const plain = stripAnsi(text);
    expect(plain).toContain('unknown component `mystery`');
    expect(plain).toContain('kept body');
    expect(plain).toContain('┌');
    expect(plain).toContain('└');
  });

  it('renders an inline directive fallback inline, never a framed box', () => {
    const text = renderMarkToAnsi('before :ghost[label] after\n', empty);
    const plain = stripAnsi(text);
    // The label and the passed-through content are separated by a colon:
    // a terminal has no styling a reader can count on at color level
    // `'none'`, so without it the label runs into the author's words.
    expect(plain).toContain('unknown component `ghost`: label');
    expect(plain).not.toContain('┌');
  });

  it('omits the separator when an inline fallback has no content to separate', () => {
    const plain = stripAnsi(renderMarkToAnsi('before :ghost after\n', empty));
    expect(plain).toContain('unknown component `ghost`');
    expect(plain).not.toContain('`ghost`:');
  });
});

describe('registered components', () => {
  it('receives already-rendered children and its own attributes', () => {
    const text = renderMarkToAnsi(
      ':::callout{type=info}\n**hi** there\n:::\n',
      withComponents,
    );
    expect(stripAnsi(text)).toContain('[info] hi there');
  });

  it('resolves an alias, with the alias preset reaching the component', () => {
    const text = renderMarkToAnsi(':::warn\nheads up\n:::\n', withComponents);
    expect(stripAnsi(text)).toContain('[warning] heads up');
  });

  it('a registered alias never shadows a real component of the same name', () => {
    const reg = createAnsiRegistry(
      { callout: { component: callout } },
      { callout: { name: 'badge' } },
    );
    const text = renderMarkToAnsi(':::callout\nx\n:::\n', reg);
    expect(stripAnsi(text)).toContain('[note] x');
  });
});

describe('form/kind mismatch', () => {
  it('a block-only component written inline degrades to the inline fallback', () => {
    const reg = createAnsiRegistry({
      panel: { component: callout, inline: false },
    });
    const text = renderMarkToAnsi('see :panel[x] here\n', reg);
    expect(stripAnsi(text)).toContain('block component `panel` written inline');
  });

  it('an inline component written as a block is permitted (no degrade)', () => {
    const text = renderMarkToAnsi(':::badge\ncontent\n:::\n', withComponents);
    expect(stripAnsi(text)).toContain('[content]');
  });
});

describe('layout presets (width/align)', () => {
  it('strips width/align from the attributes a component sees', () => {
    const seen: string[] = [];
    const probe: AnsiComponent = (attrs, children) => {
      seen.push(JSON.stringify(attrs));
      return children();
    };
    const reg = createAnsiRegistry({ box: { component: probe } });
    renderMarkToAnsi(':::box{width=wide align=center}\nx\n:::\n', reg);
    expect(seen[0]).toBe('{}');
  });

  it('never applies layout to an inline directive, and drops invalid values silently', () => {
    const text = renderMarkToAnsi(
      'a :badge[x]{width=huge} b\n',
      withComponents,
    );
    expect(stripAnsi(text)).toContain('[x]');
  });
});

describe('hostile directive names never throw', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    it(`a directive named ${name} renders the fallback, not a prototype member`, () => {
      const text = renderMarkToAnsi(`:::${name}\nbody\n:::\n`, withComponents);
      expect(stripAnsi(text)).toContain(`unknown component \`${name}\``);
    });
  }
});

describe('script-fence folding', () => {
  it('folds a {name=...} fence into a one-line collapsed marker', () => {
    const text = renderMarkToAnsi(
      '```lua {name=stars}\nreturn 1\n```\n',
      empty,
    );
    const plain = stripAnsi(text);
    expect(plain).toContain('⚙ stars · lua');
    expect(plain).not.toContain('return 1');
  });

  it('shows a src= reference detail', () => {
    const text = renderMarkToAnsi(
      '```lua {name=s src=scripts/etl.lua}\n\n```\n',
      empty,
    );
    expect(stripAnsi(text)).toContain('⚙ s · scripts/etl.lua');
  });

  it('a fence whose name is invalid (a dot) stays an ordinary code block', () => {
    const text = renderMarkToAnsi('```lua {name=a.b}\nx\n```\n', empty);
    const plain = stripAnsi(text);
    expect(plain).not.toContain('⚙');
    expect(plain).toContain('x');
  });

  it('a plain fence with no name stays an ordinary code block', () => {
    const text = renderMarkToAnsi('```js\nconsole.log(1)\n```\n', empty);
    const plain = stripAnsi(text);
    expect(plain).not.toContain('⚙');
    expect(plain).toContain('console.log(1)');
  });
});

describe('a throwing component is contained, never fails the document', () => {
  it('renders a component-error box and still renders siblings', () => {
    const boom: AnsiComponent = () => {
      throw new Error('kaboom');
    };
    const reg = createAnsiRegistry({ boom: { component: boom } });
    const text = renderMarkToAnsi(
      '# heading\n\n:::boom\nx\n:::\n\nafter\n',
      reg,
    );
    const plain = stripAnsi(text);
    expect(plain).toContain('component `boom` failed to render');
    expect(plain).not.toContain('kaboom');
    expect(plain).toContain('heading');
    expect(plain).toContain('after');
  });
});

describe(':value[...] built-in', () => {
  it('renders the missing marker with the name in braces (no store)', () => {
    const text = renderMarkToAnsi('stars: :value[repo.stars]\n', empty);
    expect(stripAnsi(text)).toContain('stars: {repo.stars}');
  });

  it('renders the resolved value from a store', () => {
    const store = createValueStore({ stars: { value: 42, status: 'fresh' } });
    const text = renderMarkToAnsi('stars: :value[stars]\n', empty, store);
    expect(stripAnsi(text)).toContain('stars: 42');
  });

  it('walks a dotted path into a stored object', () => {
    const store = createValueStore({
      repo: { value: { stars: 7 }, status: 'fresh' },
    });
    const text = renderMarkToAnsi('stars: :value[repo.stars]\n', empty, store);
    expect(stripAnsi(text)).toContain('stars: 7');
  });

  it('a stale value gets the stale suffix', () => {
    const store = createValueStore({ stars: { value: 1, status: 'stale' } });
    const text = renderMarkToAnsi(':value[stars]\n', empty, store);
    expect(stripAnsi(text)).toContain('1 (stale)');
  });

  it('an error status shows the failure phrase', () => {
    const store = createValueStore({
      stars: {
        value: undefined,
        status: 'error',
        error: 'boom',
        failureKind: 'capability-denied',
      },
    });
    const text = renderMarkToAnsi(':value[stars]\n', empty, store);
    expect(stripAnsi(text)).toContain('(needs permission)');
  });

  it('resolves an @-prefixed name against the vault', () => {
    const { store: vault, writer } = createVaultStore();
    void writer.publish('gh', { value: 100, status: 'fresh' });
    const text = renderMarkToAnsi(':value[@gh]\n', empty, undefined, vault);
    expect(stripAnsi(text)).toContain('100');
  });
});

describe('data= binding', () => {
  it('threads data/dataStatus onto the component context', () => {
    const store = createValueStore({ n: { value: 5, status: 'fresh' } });
    const probe: AnsiComponent = (_attrs, _children, ctx) =>
      `${String(ctx.data)}:${ctx.dataStatus}`;
    const reg = createAnsiRegistry({ box: { component: probe } });
    const text = renderMarkToAnsi(':::box{data=n}\n\n:::\n', reg, store);
    expect(stripAnsi(text)).toContain('5:fresh');
  });

  it('data*, all four, stay undefined together with no data= attribute', () => {
    const probe: AnsiComponent = (_attrs, _children, ctx) =>
      String('data' in ctx) + String(ctx.dataStatus === undefined);
    const reg = createAnsiRegistry({ box: { component: probe } });
    const text = renderMarkToAnsi(':::box\n\n:::\n', reg);
    expect(stripAnsi(text)).toContain('falsetrue');
  });
});

describe('empty-inline and invalid-enum quiet markers', () => {
  it('an inline: true component with no content gets the empty-inline marker text', () => {
    const text = renderMarkToAnsi(':badge[]\n', withComponents);
    expect(stripAnsi(text)).toContain('no content');
  });

  it('an invalid enum value on a known stdlib attribute still renders, with a quiet marker and a diagnostic', () => {
    const diagnostics: unknown[] = [];
    const passthrough: AnsiComponent = (attrs) => `type=${String(attrs.type)}`;
    const reg = createAnsiRegistry({ callout: { component: passthrough } });
    const text = renderMarkToAnsi(
      ':::callout{type=bogus}\nx\n:::\n',
      reg,
      undefined,
      undefined,
      {
        onDiagnostic: (event) => diagnostics.push(event),
      },
    );
    expect(stripAnsi(text)).toContain('[callout: type ignored]');
    expect(stripAnsi(text)).not.toContain('is not a valid type value');
    expect(diagnostics).toHaveLength(1);
    expect((diagnostics[0] as { message: string }).message).toContain(
      'is not a valid type value',
    );
  });
});

describe('links and images', () => {
  it('renders a link as text plus the url when color is none', () => {
    const text = renderMarkToAnsi(
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

  it('prints the url once when the link text equals the url', () => {
    const text = renderMarkToAnsi(
      '<https://example.com>\n',
      empty,
      undefined,
      undefined,
      { color: 'never' },
    );
    const occurrences = text.split('https://example.com').length - 1;
    expect(occurrences).toBe(1);
  });

  it('sanitizes a javascript: link href via @markii/core, never emitting it', () => {
    const text = renderMarkToAnsi('[click](javascript:alert(1))\n', empty);
    expect(text).not.toContain('javascript:');
  });

  it('renders an image as [alt] (src)', () => {
    const text = renderMarkToAnsi('![a cat](cat.png)\n', empty);
    expect(text).toContain('[a cat] (cat.png)');
  });
});

describe('renderMarkNodeToAnsi / renderMarkInlineToAnsi', () => {
  it('renderMarkInlineToAnsi renders a lone inline directive without a paragraph wrapper', () => {
    const text = renderMarkInlineToAnsi(':badge[hi]', withComponents);
    expect(stripAnsi(text).trim()).toBe('[hi]');
  });

  it('renderMarkNodeToAnsi accepts a whole parsed root', () => {
    const text = renderMarkToAnsi('hello\n', empty);
    expect(text).toContain('hello');
    // Cross-check against the node-based entry point for the same source.
    const nodeText = renderMarkNodeToAnsi(
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
  it('prefixes each blockquote line with a bar', () => {
    const text = renderMarkToAnsi('> quoted text\n', empty);
    expect(stripAnsi(text)).toContain('│ quoted text');
  });

  it('renders a task list item with its checked state', () => {
    const text = renderMarkToAnsi('- [x] done\n- [ ] not done\n', empty);
    const plain = stripAnsi(text);
    expect(plain).toContain('[x] done');
    expect(plain).toContain('[ ] not done');
  });

  it('renders an ordered list honoring a start value', () => {
    const text = renderMarkToAnsi('3. three\n4. four\n', empty);
    const plain = stripAnsi(text);
    expect(plain).toContain('3. three');
    expect(plain).toContain('4. four');
  });
});

describe('thematic break and table', () => {
  it('renders a thematic break as a full-width rule', () => {
    const text = renderMarkToAnsi('---\n', empty, undefined, undefined, {
      width: 10,
    });
    const plain = stripAnsi(text).trim();
    expect(plain).toBe('─'.repeat(10));
  });

  it('renders a GFM table as a box-drawn grid with a header row', () => {
    // Phase 2: renderTable now shares `./components/table-grid.js`'s
    // `drawTableGrid` with the data-bound `::table` component, so an
    // ordinary markdown table draws real box-drawing glyphs at the real
    // available width instead of the earlier `+---+` ASCII stopgap.
    const text = renderMarkToAnsi('| a | b |\n| - | - |\n| 1 | 2 |\n', empty);
    const plain = stripAnsi(text);
    expect(plain).toContain('┌');
    expect(plain).toContain('a');
    expect(plain).toContain('1');
    expect(plain).toContain('└');
  });
});

describe('escaping and sanitization', () => {
  it('drops raw HTML and never emits a script tag', () => {
    const text = renderMarkToAnsi('text\n\n<script>alert(1)</script>\n', empty);
    expect(text).not.toContain('<script>');
  });

  it('ctx.text strips the ESC byte a component prints, so no live escape survives', () => {
    const evil: AnsiComponent = (_attrs, _children, ctx) =>
      ctx.text('a\x1b[31mb');
    const reg = createAnsiRegistry({ evil: { component: evil } });
    const text = renderMarkToAnsi(':::evil\n:::\n', reg);
    expect(text).not.toContain('\x1b');
    expect(text).toContain('a[31mb');
  });
});

describe('block separation', () => {
  it('separates two blocks with exactly one blank line, never a whitespace-only line between them', () => {
    const text = renderMarkToAnsi(
      'First paragraph.\n\nSecond paragraph.\n',
      empty,
    );
    expect(text).toBe('First paragraph.\n\nSecond paragraph.\n');
  });

  it('emits no line that is only whitespace, for a document of every block kind', () => {
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
    const text = renderMarkToAnsi(source, empty, undefined, undefined, {
      width: 40,
      color: 'never',
    });
    const whitespaceOnly = text
      .split('\n')
      .filter((line) => line !== '' && line.trim() === '');
    expect(whitespaceOnly).toEqual([]);
  });

  it('a block quote carries no empty quoted lines around its paragraph', () => {
    const text = renderMarkToAnsi(
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

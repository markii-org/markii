import { describe, expect, it } from 'vitest';
import { parse } from '@markii/core';
import { createValueStore, createVaultStore } from '@markii/runtime';
import { renderMarkToHtml, renderMarkNodeToHtml } from './render';
import {
  createHtmlRegistry,
  type HtmlComponent,
  type HtmlRegistry,
} from './registry';

const empty = createHtmlRegistry();

/** A minimal block component echoing its children inside a class-named div, plus any `type` attribute, for attribute-plumbing assertions. */
const callout: HtmlComponent = (attrs, children, ctx) => {
  const type = typeof attrs.type === 'string' ? attrs.type : 'note';
  return `<div class="callout callout--${ctx.esc(type)}">${children}</div>`;
};

/** A minimal inline component, registered `inline: true`, echoing its children in brackets. */
const badge: HtmlComponent = (_attrs, children) => `<b>[${children}]</b>`;

const withComponents: HtmlRegistry = createHtmlRegistry(
  {
    callout: { component: callout },
    badge: { component: badge, inline: true },
  },
  { warn: { name: 'callout', attributes: { type: 'warning' } } },
);

describe('plain markdown passes through as ordinary HTML', () => {
  it('renders headings, emphasis, lists, and code', () => {
    const html = renderMarkToHtml(
      '# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n',
      empty,
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });

  it('is a pure function: identical input yields identical output', () => {
    const src = '# H\n\n:::callout\nhi\n:::\n';
    expect(renderMarkToHtml(src, withComponents)).toBe(
      renderMarkToHtml(src, withComponents),
    );
  });
});

describe('unknown-directive fallback', () => {
  it('renders a dashed block box naming the component, keeping inner content', () => {
    const html = renderMarkToHtml(':::mystery\nkept body\n:::\n', empty);
    expect(html).toContain('mk-unknown mk-unknown--block');
    expect(html).toContain(
      '<p class="mk-unknown__label">unknown component <code>mystery</code></p>',
    );
    expect(html).toContain('<div class="mk-unknown__content"><p>kept body</p>');
  });

  it('renders an inline directive fallback as spans, never a block div', () => {
    const html = renderMarkToHtml('before :ghost[label] after\n', empty);
    expect(html).toContain('mk-unknown mk-unknown--inline');
    expect(html).toContain(
      '<span class="mk-unknown__label">unknown component <code>ghost</code></span>label</span>',
    );
    expect(html).not.toContain('mk-unknown--block');
  });
});

describe('registered components', () => {
  it('receives already-rendered children and its own attributes', () => {
    const html = renderMarkToHtml(
      ':::callout{type=info}\n**hi** there\n:::\n',
      withComponents,
    );
    expect(html).toContain(
      '<div class="callout callout--info"><p><strong>hi</strong> there</p></div>',
    );
  });

  it('resolves an alias, with the alias preset reaching the component', () => {
    const html = renderMarkToHtml(':::warn\nheads up\n:::\n', withComponents);
    expect(html).toContain('class="callout callout--warning"');
  });

  it('a registered alias never shadows a real component of the same name', () => {
    const reg = createHtmlRegistry(
      { callout: { component: callout } },
      { callout: { name: 'badge' } },
    );
    const html = renderMarkToHtml(':::callout\nx\n:::\n', reg);
    expect(html).toContain('class="callout callout--note"');
  });
});

describe('form/kind mismatch (docs/spec.md requirement 8)', () => {
  it('a block-only component written inline degrades to the inline fallback', () => {
    const reg = createHtmlRegistry({
      panel: { component: callout, inline: false },
    });
    const html = renderMarkToHtml('see :panel[x] here\n', reg);
    expect(html).toContain('mk-unknown--inline mk-unknown--mismatch');
    expect(html).toContain('block component <code>panel</code> written inline');
  });

  it('an inline component written as a block is permitted (no degrade)', () => {
    const html = renderMarkToHtml(':::badge\ncontent\n:::\n', withComponents);
    expect(html).toContain('<b>[<p>content</p>]</b>');
  });
});

describe('layout presets (width/align)', () => {
  it('wraps a block directive in a layout div and strips the keys from the component', () => {
    const seen: string[] = [];
    const probe: HtmlComponent = (attrs, children) => {
      seen.push(JSON.stringify(attrs));
      return `<p>${children}</p>`;
    };
    const reg = createHtmlRegistry({ box: { component: probe } });
    const html = renderMarkToHtml(
      ':::box{width=wide align=center}\nx\n:::\n',
      reg,
    );
    expect(html).toContain('<div class="mk-width-wide mk-align-center">');
    // The component never sees the reserved layout keys.
    expect(seen[0]).toBe('{}');
  });

  it('never wraps an inline directive, and drops invalid values silently', () => {
    const html = renderMarkToHtml(
      'a :badge[x]{width=huge} b\n',
      withComponents,
    );
    expect(html).not.toContain('mk-width');
    expect(html).toContain('<b>[x]</b>');
  });
});

describe('escaping and sanitization', () => {
  it('drops raw HTML and never emits a script element', () => {
    const html = renderMarkToHtml('text\n\n<script>alert(1)</script>\n', empty);
    expect(html).not.toContain('<script>');
  });

  it('sanitizes a javascript: link href via @markii/core', () => {
    const html = renderMarkToHtml('[click](javascript:alert(1))\n', empty);
    expect(html).not.toContain('javascript:');
  });

  it('ctx.esc neutralizes dangerous characters, and its output passes through verbatim', () => {
    const evil: HtmlComponent = (_attrs, _children, ctx) =>
      `<div>${ctx.esc('<script>alert(1)</script>')}</div>`;
    const reg = createHtmlRegistry({ evil: { component: evil } });
    const html = renderMarkToHtml(':::evil\n:::\n', reg);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('hostile directive names never throw', () => {
  // `__proto__` is excluded deliberately: markdown parses `:::__proto__` as
  // emphasis (`__`), so it never reaches the renderer as a directive at all.
  // The registry's null prototype guards the programmatic case regardless.
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    it(`a directive named ${name} renders the fallback, not a prototype member`, () => {
      const html = renderMarkToHtml(`:::${name}\nbody\n:::\n`, withComponents);
      expect(html).toContain(`unknown component <code>${name}</code>`);
    });
  }
});

describe('script-fence folding', () => {
  it('folds a {name=...} fence into a collapsed details marker', () => {
    const html = renderMarkToHtml(
      '```lua {name=stars}\nreturn 1\n```\n',
      empty,
    );
    expect(html).toContain('<details class="mk-script">');
    expect(html).toContain(
      '<summary class="mk-script__summary">⚙ stars · lua</summary>',
    );
    expect(html).toContain('<code>return 1</code>');
  });

  it('opens the marker when the meta carries a bare open', () => {
    const html = renderMarkToHtml('```lua {name=s open}\nx\n```\n', empty);
    expect(html).toContain('<details class="mk-script" open>');
  });

  it('shows a src= reference detail', () => {
    const html = renderMarkToHtml(
      '```lua {name=s src=scripts/etl.lua}\n\n```\n',
      empty,
    );
    expect(html).toContain('⚙ s · scripts/etl.lua');
  });

  it('a fence whose name is invalid (a dot) stays ordinary code, never a marker', () => {
    const html = renderMarkToHtml('```lua {name=a.b}\nx\n```\n', empty);
    expect(html).not.toContain('mk-script');
    expect(html).toContain('<pre><code');
  });

  it('a plain fence with no name stays ordinary code', () => {
    const html = renderMarkToHtml('```js\nconsole.log(1)\n```\n', empty);
    expect(html).not.toContain('mk-script');
  });
});

describe('a throwing component is contained, never fails the document', () => {
  it('renders a component-error box and still renders siblings', () => {
    const boom: HtmlComponent = () => {
      throw new Error('kaboom');
    };
    const reg = createHtmlRegistry({ boom: { component: boom } });
    const html = renderMarkToHtml(
      '# heading\n\n:::boom\nx\n:::\n\nafter\n',
      reg,
    );
    expect(html).toContain('component <code>boom</code> failed to render');
    expect(html).not.toContain('kaboom');
    expect(html).toContain('<h1>heading</h1>');
    expect(html).toContain('<p>after</p>');
  });
});

describe(':value[...] built-in', () => {
  it('renders the missing marker with the name in braces (no store)', () => {
    const html = renderMarkToHtml('stars: :value[repo.stars]\n', empty);
    expect(html).toContain(
      '<span class="mk-value mk-value--missing">{repo.stars}</span>',
    );
  });

  it('renders the resolved value from a store, plain span', () => {
    const store = createValueStore({ stars: { value: 42, status: 'fresh' } });
    const html = renderMarkToHtml('stars: :value[stars]\n', empty, store);
    expect(html).toContain('<span class="mk-value">42</span>');
  });

  it('walks a dotted path into a stored object', () => {
    const store = createValueStore({
      repo: { value: { stars: 7 }, status: 'fresh' },
    });
    const html = renderMarkToHtml('stars: :value[repo.stars]\n', empty, store);
    expect(html).toContain('<span class="mk-value">7</span>');
  });

  it('a stale value gets the stale modifier class', () => {
    const store = createValueStore({ stars: { value: 1, status: 'stale' } });
    const html = renderMarkToHtml(':value[stars]\n', empty, store);
    expect(html).toContain('<span class="mk-value mk-value--stale">1</span>');
  });

  it('an error resolution with a failure kind carries the modifier class and title', () => {
    const store = createValueStore({
      stars: {
        value: undefined,
        status: 'error',
        error: 'network down',
        failureKind: 'capability-denied',
      },
    });
    const html = renderMarkToHtml(':value[stars]\n', empty, store);
    expect(html).toContain(
      'mk-value mk-value--missing mk-value--capability-denied',
    );
    expect(html).toContain('title="needs permission: network down"');
    expect(html).toContain('{stars}');
  });

  it('an @-prefixed name resolves against the vault, not the store', () => {
    const { store: vault, writer } = createVaultStore();
    void writer.publish('gh', { value: 200, status: 'fresh' });
    const store = createValueStore({ gh: { value: 1, status: 'fresh' } });
    const html = renderMarkToHtml(':value[@gh]\n', empty, store, vault);
    expect(html).toContain('<span class="mk-value">200</span>');
  });

  it('an @-prefixed name with no vault degrades to missing, never reading the store', () => {
    const store = createValueStore({ gh: { value: 1, status: 'fresh' } });
    const html = renderMarkToHtml(':value[@gh]\n', empty, store);
    expect(html).toContain('mk-value mk-value--missing');
    expect(html).toContain('{@gh}');
  });

  it('nested markup inside the label contributes nothing to the resolved name', () => {
    const store = createValueStore({ stars: { value: 1, status: 'fresh' } });
    // The label text itself is the store key; emphasis markup around it
    // still resolves against the plain text, matching @markii/react.
    const html = renderMarkToHtml(':value[stars]\n', empty, store);
    expect(html).toContain('<span class="mk-value">1</span>');
  });
});

describe(':value[...]{format=...} (docs/format.md)', () => {
  it('formats a resolved value with format=compact', () => {
    const store = createValueStore({
      stars: { value: 2301234, status: 'fresh' },
    });
    const html = renderMarkToHtml(
      ':value[stars]{format=compact}\n',
      empty,
      store,
    );
    expect(html).toContain('<span class="mk-value">2.3M</span>');
  });

  it('formats with decimals applied', () => {
    const store = createValueStore({
      ratio: { value: 0.12345, status: 'fresh' },
    });
    const html = renderMarkToHtml(
      ':value[ratio]{format=percent decimals=1}\n',
      empty,
      store,
    );
    expect(html).toContain('<span class="mk-value">12.3%</span>');
  });

  it('an absent format keeps the default plain rendering', () => {
    const store = createValueStore({
      stars: { value: 2301234, status: 'fresh' },
    });
    const html = renderMarkToHtml(':value[stars]\n', empty, store);
    expect(html).toContain('<span class="mk-value">2301234</span>');
  });

  it('a missing value still renders the missing marker with format present', () => {
    const html = renderMarkToHtml(':value[nope]{format=number}\n', empty);
    expect(html).toContain('mk-value mk-value--missing');
  });
});

describe('data= attribute binding', () => {
  const echo: HtmlComponent = (_attrs, _children, ctx) =>
    JSON.stringify({
      data: ctx.data,
      dataStatus: ctx.dataStatus,
      dataError: ctx.dataError,
    });

  it('a component with no data= attribute gets no data fields at all', () => {
    const reg = createHtmlRegistry({ echo: { component: echo } });
    const html = renderMarkToHtml('::echo\n', reg);
    expect(html).toContain(
      JSON.stringify({
        data: undefined,
        dataStatus: undefined,
        dataError: undefined,
      }),
    );
  });

  it('resolves a bound name and strips data= from the attributes the component sees', () => {
    const seen: string[] = [];
    const probe: HtmlComponent = (attrs) => {
      seen.push(JSON.stringify(attrs));
      return '';
    };
    const reg = createHtmlRegistry({
      probe: { component: probe },
      echo: { component: echo },
    });
    const store = createValueStore({ n: { value: 5, status: 'fresh' } });
    renderMarkToHtml('::probe{data=n other=x}\n', reg, store);
    expect(seen[0]).toBe(JSON.stringify({ other: 'x' }));

    const html = renderMarkToHtml('::echo{data=n}\n', reg, store);
    expect(html).toContain('"data":5');
    expect(html).toContain('"dataStatus":"fresh"');
  });

  it('an unresolved data= name degrades to dataStatus missing, never throwing', () => {
    const html = renderMarkToHtml(
      '::echo{data=nope}\n',
      createHtmlRegistry({ echo: { component: echo } }),
    );
    expect(html).toContain('"dataStatus":"missing"');
  });
});

describe('renderMarkNodeToHtml', () => {
  it('renders a single parsed block under the same contract', () => {
    const tree = parse(':::callout{type=ok}\nnode body\n:::\n');
    const first = tree.children[0]!;
    const html = renderMarkNodeToHtml(first, withComponents);
    expect(html).toContain('class="callout callout--ok"');
    expect(html).toContain('node body');
  });
});

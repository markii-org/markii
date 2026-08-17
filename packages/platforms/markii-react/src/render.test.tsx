import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forwardRef, memo } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { conformanceDir } from '@markii/core/corpus';
import { createValueStore, createVaultStore } from '@markii/runtime';
import { renderMark } from './render';
import { defaultRegistry } from './components';
import type {
  DirectiveAttributes,
  Registry,
  MarkComponentProps,
} from './registry';

function readFixture(name: string): string {
  return readFileSync(join(conformanceDir(), name), 'utf8');
}

function renderFixture(name: string, registry: Registry = defaultRegistry) {
  return render(renderMark(readFixture(name), registry));
}

describe('renderMark', () => {
  it('renders plain markdown passthrough with no components involved', () => {
    const { container } = renderFixture('01-plain-markdown.mk.md');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Plain markdown passthrough',
    );
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'a link' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });

  it('renders the built-in kbd component for inline text directives', () => {
    const { container } = renderFixture('02-inline-directive.mk.md');
    const keys = container.querySelectorAll('kbd.mk-kbd');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toHaveTextContent('Ctrl+S');
    expect(keys[1]).toHaveTextContent('Cmd+Shift+P');
  });

  it('renders the built-in rating component for a leaf directive, clamped', () => {
    renderFixture('03-leaf-directive.mk.md');
    const rating = screen.getByRole('img', { name: 'rating: 3 out of 5' });
    expect(rating.querySelectorAll('.mk-rating__star')).toHaveLength(5);
    expect(rating.querySelectorAll('.mk-rating__star--filled')).toHaveLength(3);
  });

  it('renders the built-in callout component for a container directive', () => {
    const { container } = renderFixture('04-container-directive.mk.md');
    const callout = container.querySelector('.mk-callout--warning');
    expect(callout).not.toBeNull();
    expect(callout).toHaveTextContent('Careful');
    expect(screen.getByRole('link', { name: 'link' })).toBeInTheDocument();
  });

  it('handles quoted, bare, and missing attributes gracefully', () => {
    const { container } = renderFixture('05-attributes.mk.md');
    const callouts = container.querySelectorAll('.mk-callout');
    expect(callouts).toHaveLength(4);
    expect(callouts[0]).toHaveClass('mk-callout--warning');
    expect(callouts[0]).toHaveTextContent('Quoted title with spaces');
    expect(callouts[1]).toHaveClass('mk-callout--danger');
    expect(callouts[2]).toHaveClass('mk-callout--info');
    expect(callouts[3]).toHaveClass('mk-callout--info');
    expect(callouts[3]).toHaveTextContent('bare (valueless) attribute');
  });

  it('renders directives nested inside directives, with no stray fence markers', () => {
    const { container } = renderFixture('06-nested-directives.mk.md');
    const callouts = container.querySelectorAll('.mk-callout');
    expect(callouts).toHaveLength(2);
    const outer = callouts[0];
    expect(outer).toHaveClass('mk-callout--info');
    expect(outer?.querySelector('.mk-callout--warning')).not.toBeNull();
    expect(outer?.querySelector('.mk-rating')).not.toBeNull();
    expect(outer?.querySelector('kbd.mk-kbd')).toHaveTextContent('Enter');
    // A malformed fixture (equal fence lengths on the outer/inner callout)
    // would leave a literal ":::" paragraph in the output where the outer
    // closes early; the fixture uses a longer outer fence (::::) precisely
    // so no such stray marker text ever reaches the rendered document.
    expect(container.textContent ?? '').not.toContain(':::');
  });

  it('renders a fallback box for unknown directives, block and inline', () => {
    const { container } = renderFixture('07-unknown-directive.mk.md');
    const fallbacks = container.querySelectorAll('.mk-unknown');
    expect(fallbacks).toHaveLength(3);

    const inlineFallback = container.querySelector('.mk-unknown--inline');
    expect(inlineFallback?.tagName).toBe('SPAN');
    expect(inlineFallback).toHaveTextContent('unknown component');
    expect(inlineFallback).toHaveTextContent('sparkle');

    const blockFallbacks = container.querySelectorAll('.mk-unknown--block');
    expect(blockFallbacks).toHaveLength(2);
    const names = Array.from(blockFallbacks).map((el) => el.textContent ?? '');
    expect(names.some((text) => text.includes('timeline'))).toBe(true);
    expect(names.some((text) => text.includes('widget'))).toBe(true);
  });

  it('does not render directive-like text inside a code fence as a component', () => {
    const { container } = renderFixture('08-code-fence.mk.md');
    expect(container.querySelectorAll('.mk-callout')).toHaveLength(1);
    expect(container.querySelector('.mk-callout')).toHaveTextContent('Real');

    const codeBlock = container.querySelector('pre code');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.textContent ?? '').toContain(
      ':::callout{type=warning title="Not real"}',
    );
    expect(codeBlock?.textContent ?? '').toContain(':kbd[Ctrl+S]');

    const inlineCode = screen.getByText(':kbd[literal]');
    expect(inlineCode.tagName).toBe('CODE');
  });

  it('does not throw on a malformed, unclosed container directive', () => {
    expect(() => renderFixture('09-malformed-container.mk.md')).not.toThrow();
    const { container } = renderFixture('09-malformed-container.mk.md');
    expect(container.querySelector('.mk-callout--danger')).not.toBeNull();
  });

  it('never throws for a directive name that collides with an inherited Object.prototype member', () => {
    expect(() => renderMark(':::constructor\nhi\n:::', {})).not.toThrow();
    const { container } = render(renderMark(':::constructor\nhi\n:::', {}));
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent('constructor');
  });

  it('renders the fallback box (not a blank document) for every directive name that collides with an inherited Object.prototype member', () => {
    const { container } = renderFixture('10-prototype-names.mk.md', {});
    const fallbacks = container.querySelectorAll('.mk-unknown');
    expect(fallbacks).toHaveLength(4);
    const names = Array.from(fallbacks).map((el) => el.textContent ?? '');
    expect(names.some((text) => text.includes('constructor'))).toBe(true);
    expect(names.some((text) => text.includes('toString'))).toBe(true);
    expect(names.some((text) => text.includes('hasOwnProperty'))).toBe(true);
    expect(names.some((text) => text.includes('valueOf'))).toBe(true);

    // The rest of the document must still render — a prototype-chain
    // collision on one directive must not blank the whole note.
    expect(container.querySelector('h1')).toHaveTextContent(
      'Prototype-name directives',
    );
    expect(container.textContent ?? '').toContain(
      'Normal paragraph after all four collisions',
    );
  });

  it('normalizes bare attributes to null (not empty string) for registry components', () => {
    let seenAttributes: DirectiveAttributes | undefined;
    const probeRegistry: Registry = {
      probe: {
        component: ({ attributes }: MarkComponentProps) => {
          seenAttributes = attributes;
          return null;
        },
        inline: false,
      },
    };

    render(renderMark('::probe{collapsed src="a.json"}', probeRegistry));

    expect(seenAttributes).toEqual({ collapsed: null, src: 'a.json' });
  });

  it('renders a React.memo-wrapped component, not the unknown-directive fallback', () => {
    // `typeof` a memoized component is `'object'`, not `'function'` — a
    // regression here would silently fall through to the fallback box
    // instead of rendering the registered component.
    const MemoProbe = memo(function MemoProbe({
      children,
    }: MarkComponentProps) {
      return <div className="memo-probe">{children}</div>;
    });
    const registry: Registry = { memoprobe: { component: MemoProbe } };

    const { container } = render(
      renderMark(':::memoprobe\nhello\n:::', registry),
    );

    expect(container.querySelector('.memo-probe')).toHaveTextContent('hello');
    expect(container.querySelector('.mk-unknown')).toBeNull();
  });

  it('renders a React.forwardRef-wrapped component, not the unknown-directive fallback', () => {
    // Same `typeof === 'object'` hazard as React.memo, via a different API.
    const ForwardRefProbe = forwardRef<HTMLDivElement, MarkComponentProps>(
      function ForwardRefProbe({ children }, ref) {
        return (
          <div ref={ref} className="forwardref-probe">
            {children}
          </div>
        );
      },
    );
    const registry: Registry = {
      forwardrefprobe: { component: ForwardRefProbe },
    };

    const { container } = render(
      renderMark(':::forwardrefprobe\nhello\n:::', registry),
    );

    expect(container.querySelector('.forwardref-probe')).toHaveTextContent(
      'hello',
    );
    expect(container.querySelector('.mk-unknown')).toBeNull();
  });
});

describe('renderMark — :value[name] interpolation', () => {
  it('renders a fresh value inline as plain text', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh', ranAt: 1000 },
    });
    const { container } = render(
      renderMark('Repo has :value[stars] stars.', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-value')).toHaveTextContent('42');
    expect(container.querySelector('.mk-value--missing')).toBeNull();
    expect(container.querySelector('.mk-value--stale')).toBeNull();
  });

  it('marks a stale value with the stale class while still showing it', () => {
    const store = createValueStore({
      stars: { value: 41, status: 'stale', ranAt: 500 },
    });
    const { container } = render(
      renderMark(':value[stars]', defaultRegistry, store),
    );
    const stale = container.querySelector('.mk-value--stale');
    expect(stale).not.toBeNull();
    expect(stale).toHaveTextContent('41');
  });

  it('renders a graceful missing marker when the store has no such name', () => {
    const store = createValueStore();
    const { container } = render(
      renderMark(':value[stars]', defaultRegistry, store),
    );
    const missing = container.querySelector('.mk-value--missing');
    expect(missing).not.toBeNull();
    expect(missing).toHaveTextContent('stars');
  });

  it('renders a graceful missing marker when no store is provided at all', () => {
    expect(() =>
      render(renderMark(':value[stars]', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(renderMark(':value[stars]', defaultRegistry));
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });

  it('renders a graceful missing marker for an errored value, and never throws', () => {
    const store = createValueStore({
      stars: { value: null, status: 'error', error: 'fetch failed' },
    });
    expect(() =>
      render(renderMark(':value[stars]', defaultRegistry, store)),
    ).not.toThrow();
    const { container } = render(
      renderMark(':value[stars]', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });

  it('renders a nested field of a stored object via a dotted path', () => {
    const store = createValueStore({
      repo: { value: { stars: 99 }, status: 'fresh', ranAt: 1000 },
    });
    const { container } = render(
      renderMark(':value[repo.stars]', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-value')).toHaveTextContent('99');
  });

  it('renders a graceful missing marker for an unresolved dotted path', () => {
    const store = createValueStore({
      repo: { value: { stars: 99 }, status: 'fresh', ranAt: 1000 },
    });
    const { container } = render(
      renderMark(':value[repo.missing]', defaultRegistry, store),
    );
    const missing = container.querySelector('.mk-value--missing');
    expect(missing).not.toBeNull();
    expect(missing).toHaveTextContent('repo.missing');
  });
});

describe('renderMark — data=name attribute binding', () => {
  function probeRegistry(): {
    registry: Registry;
    seen: () => MarkComponentProps | undefined;
  } {
    let seen: MarkComponentProps | undefined;
    const registry: Registry = {
      probe: {
        component: (props: MarkComponentProps) => {
          seen = props;
          return (
            <div className="probe" data-status={String(props.dataStatus)} />
          );
        },
        inline: false,
      },
    };
    return { registry, seen: () => seen };
  }

  it('injects the resolved store value as the `data` prop, plus a fresh `dataStatus`', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh', ranAt: 1000 },
    });
    const { registry, seen } = probeRegistry();
    render(renderMark('::probe{data=stars}', registry, store));

    expect(seen()?.data).toBe(42);
    expect(seen()?.dataStatus).toBe('fresh');
    // The raw store-name string must not leak through as `attributes.data`.
    expect(seen()?.attributes).toEqual({});
  });

  it('degrades gracefully when the named value is missing from the store', () => {
    const store = createValueStore();
    const { registry, seen } = probeRegistry();
    expect(() =>
      render(renderMark('::probe{data=stars}', registry, store)),
    ).not.toThrow();

    expect(seen()?.data).toBeUndefined();
    expect(seen()?.dataStatus).toBe('missing');
  });

  it('degrades gracefully when no store is provided at all', () => {
    const { registry, seen } = probeRegistry();
    expect(() =>
      render(renderMark('::probe{data=stars}', registry)),
    ).not.toThrow();

    expect(seen()?.data).toBeUndefined();
    expect(seen()?.dataStatus).toBe('missing');
  });

  it('leaves `data` and `dataStatus` undefined when the directive has no `data=` attribute at all', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh', ranAt: 1000 },
    });
    const { registry, seen } = probeRegistry();
    render(renderMark('::probe{label="no binding here"}', registry, store));

    expect(seen()?.data).toBeUndefined();
    expect(seen()?.dataStatus).toBeUndefined();
    expect(seen()?.attributes).toEqual({ label: 'no binding here' });
  });

  it('`data`/`dataStatus` are truly ABSENT (not merely undefined) from props when the directive has no `data=` attribute', () => {
    // Distinguishes "no binding requested" from "binding requested but
    // missing": both leave `props.data` reading as `undefined`, but only
    // the latter should leave the key present on the props object at all.
    const { registry, seen } = probeRegistry();
    render(renderMark('::probe{label="no binding here"}', registry));

    const props = seen();
    expect(props).toBeDefined();
    expect('data' in (props as object)).toBe(false);
    expect('dataStatus' in (props as object)).toBe(false);
  });

  it('`data`/`dataStatus` ARE present as keys on props (even if missing/undefined) whenever the directive had a `data=` attribute', () => {
    const store = createValueStore();
    const { registry, seen } = probeRegistry();
    render(renderMark('::probe{data=stars}', registry, store));

    const props = seen();
    expect(props).toBeDefined();
    expect('data' in (props as object)).toBe(true);
    expect('dataStatus' in (props as object)).toBe(true);
    expect(props?.dataStatus).toBe('missing');
  });

  it('leaves a normal string attribute untouched alongside a `data=` binding', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh', ranAt: 1000 },
    });
    const { registry, seen } = probeRegistry();
    render(
      renderMark('::probe{data=stars label="GitHub stars"}', registry, store),
    );

    expect(seen()?.data).toBe(42);
    expect(seen()?.attributes).toEqual({ label: 'GitHub stars' });
  });

  it('resolves a dotted path into a nested field of a stored object', () => {
    const store = createValueStore({
      repo: {
        value: { stars: 42, forks: 7, spark: [3, 5, 4] },
        status: 'fresh',
        ranAt: 1000,
      },
    });
    const { registry, seen } = probeRegistry();
    render(renderMark('::probe{data=repo.stars}', registry, store));

    expect(seen()?.data).toBe(42);
    expect(seen()?.dataStatus).toBe('fresh');
  });

  it('degrades gracefully when a dotted path does not resolve', () => {
    const store = createValueStore({
      repo: { value: { stars: 42 }, status: 'fresh', ranAt: 1000 },
    });
    const { registry, seen } = probeRegistry();
    render(renderMark('::probe{data=repo.nope}', registry, store));

    expect(seen()?.data).toBeUndefined();
    expect(seen()?.dataStatus).toBe('missing');
  });
});

describe('renderMark — collapsed script marker (docs/scripting.md)', () => {
  it('renders a script code block (meta carries {name=...}) as a collapsed, folded mk-script marker, not a bare <pre>', () => {
    const { container } = render(
      renderMark(
        [
          '```lua {name=stars}',
          'local function greet(who)',
          '  return "hi " .. who',
          'end',
          '```',
        ].join('\n'),
        defaultRegistry,
      ),
    );

    const marker = container.querySelector('details.mk-script');
    expect(marker).not.toBeNull();
    // Folded by default: React omits the `open` attribute entirely for
    // `open={false}`, so its absence IS the folded state.
    expect(marker).not.toHaveAttribute('open');

    // No bare, un-collapsed <pre> for this fence — the whole block lives
    // inside the <details> marker.
    expect(container.querySelector('pre:not(.mk-script__code)')).toBeNull();

    const summary = marker?.querySelector('.mk-script__summary');
    expect(summary).toHaveTextContent('stars');
    expect(summary).toHaveTextContent('lua');

    // Expanding reveals the exact original code: internal indentation and
    // line breaks intact, byte-for-byte.
    const code = marker?.querySelector('.mk-script__code code');
    expect(code?.textContent).toBe(
      'local function greet(who)\n  return "hi " .. who\nend',
    );
  });

  it('renders a plain code block (no meta) unchanged — no mk-script marker', () => {
    const { container } = render(
      renderMark('```lua\nprint("hi")\n```', defaultRegistry),
    );

    expect(container.querySelector('.mk-script')).toBeNull();
    const code = container.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('print("hi")\n');
  });

  // docs/scripting.md: a script `name` must match `[A-Za-z_][A-Za-z0-9_-]*`. A
  // name outside that charset means the block is NOT a script — `@markii/core`'s
  // `extractScripts` skips it, so it can never run. Folding it to a `⚙ name`
  // marker here would advertise a runnable block the runtime will never
  // execute, so the fold must be gated by the same predicate.
  it.each([
    [
      'a dotted name (reserved: `data=`/`:value[]` read a dot as a path)',
      'repo.stars',
    ],
    ['a name starting with a digit', '1stars'],
    ['a name starting with a hyphen', '-stars'],
    ['a name containing a slash', 'repo/stars'],
    ['a name containing a colon', 'repo:stars'],
  ])(
    'does not fold a script block with %s — it stays plain highlighted code',
    (_label, name) => {
      const { container } = render(
        renderMark(
          `\`\`\`lua {name=${name}}\nreturn 1\n\`\`\``,
          defaultRegistry,
        ),
      );

      expect(container.querySelector('.mk-script')).toBeNull();
      const code = container.querySelector('pre code');
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe('return 1\n');
      // The rejected name must not leak into the DOM as a marker label.
      expect(container.textContent).not.toContain('⚙');
    },
  );

  it('still folds a valid name containing the allowed `_` and `-` characters', () => {
    const { container } = render(
      renderMark('```lua {name=repo-stars_2}\nreturn 1\n```', defaultRegistry),
    );

    const marker = container.querySelector('details.mk-script');
    expect(marker).not.toBeNull();
    expect(marker?.querySelector('.mk-script__summary')?.textContent).toContain(
      'repo-stars_2',
    );
  });

  it('renders a plain code block unchanged when meta has attributes but no `name`', () => {
    const { container } = render(
      renderMark(
        '```lua {src=scripts/etl.lua}\nprint("hi")\n```',
        defaultRegistry,
      ),
    );

    expect(container.querySelector('.mk-script')).toBeNull();
    expect(container.querySelector('pre code')).not.toBeNull();
  });

  it('renders a src= long-script reference marker showing the path, with an empty body handled gracefully', () => {
    const { container } = render(
      renderMark(
        '```lua {src=scripts/etl.lua name=stars}\n```',
        defaultRegistry,
      ),
    );

    const marker = container.querySelector('details.mk-script');
    expect(marker).not.toBeNull();
    const summary = marker?.querySelector('.mk-script__summary');
    expect(summary).toHaveTextContent('stars');
    expect(summary).toHaveTextContent('scripts/etl.lua');

    // Empty body: no code element rendered, and a graceful placeholder
    // instead of a blank <pre><code></code></pre>.
    expect(marker?.querySelector('.mk-script__code')).toBeNull();
    expect(marker?.querySelector('.mk-script__empty')).not.toBeNull();
  });

  it('renders the details expanded when the meta carries a bare `open` attribute', () => {
    const { container } = render(
      renderMark('```lua {name=stars open}\nreturn 1\n```', defaultRegistry),
    );

    const marker = container.querySelector('details.mk-script');
    expect(marker).toHaveAttribute('open');
  });

  it('still treats directive-like text inside a NON-script code fence as literal (unaffected by script-marker detection)', () => {
    const { container } = render(
      renderMark(
        [
          '```',
          ':::callout{type=warning title="Not real"}',
          'This should NOT render as a callout.',
          ':::',
          '```',
        ].join('\n'),
        defaultRegistry,
      ),
    );

    expect(container.querySelector('.mk-callout')).toBeNull();
    expect(container.querySelector('.mk-script')).toBeNull();
    const code = container.querySelector('pre code');
    expect(code?.textContent ?? '').toContain(
      ':::callout{type=warning title="Not real"}',
    );
  });

  it('never throws even if meta parsing goes sideways, and falls back to ordinary code rendering', () => {
    // An attribute group with an unterminated quote: `findAttributeGroup`
    // inside `parseMetaAttributes` scans past the unmatched `"` to end of
    // string without finding a closing `}`, so no attribute group is
    // found at all — degrades to "not a script", not a crash.
    expect(() =>
      render(
        renderMark(
          '```lua {name="unterminated\nprint(1)\n```',
          defaultRegistry,
        ),
      ),
    ).not.toThrow();
  });
});

describe('renderMark — GFM (tables, task lists, strikethrough, autolinks)', () => {
  it('renders a GFM table as <table> with rows and cells, plus a directive after it in the same document', () => {
    const { container } = renderFixture('12-gfm-table.mk.md');
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('tr')).toHaveLength(3); // header + 2 rows
    expect(table?.querySelectorAll('td')).toHaveLength(6);
    expect(container.querySelector('.mk-callout--info')).not.toBeNull();
  });

  it('renders GFM task-list checkboxes with the correct checked state', () => {
    const { container } = renderFixture('13-task-list.mk.md');
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(false);
    expect(checkboxes[2]?.checked).toBe(false);
  });

  it('renders GFM strikethrough as <del>, a sanitized autolink, and an inline directive, all in one document', () => {
    const { container } = renderFixture('14-strikethrough.mk.md');
    expect(container.querySelector('del')).toHaveTextContent(
      'This text is struck through',
    );
    const link = screen.getByRole('link', {
      name: 'https://example.com/bare-autolink',
    });
    expect(link).toHaveAttribute('href', 'https://example.com/bare-autolink');
    expect(container.querySelector('kbd.mk-kbd')).toHaveTextContent('Ctrl+S');
  });

  it('renders a javascript: autolink neutralized (no href) rather than throwing', () => {
    expect(() =>
      render(renderMark('<javascript:alert(1)>', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(
      renderMark('<javascript:alert(1)>', defaultRegistry),
    );
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).not.toHaveAttribute('href');
  });
});

describe('renderMark — layout presets (docs/format.md: width/align)', () => {
  function echoRegistry(): {
    registry: Registry;
    seenAttributes: () => DirectiveAttributes | undefined;
  } {
    let seenAttributes: DirectiveAttributes | undefined;
    const registry: Registry = {
      probe: {
        component: ({ attributes }: MarkComponentProps) => {
          seenAttributes = attributes;
          return <div className="probe" />;
        },
        inline: false,
      },
    };
    return { registry, seenAttributes: () => seenAttributes };
  }

  it.each([
    ['narrow', 'mk-width-narrow'],
    ['wide', 'mk-width-wide'],
    ['full', 'mk-width-full'],
  ])('wraps a block directive in a %s width class', (value, expectedClass) => {
    const { registry } = echoRegistry();
    const { container } = render(
      renderMark(`::probe{width=${value}}`, registry),
    );
    const wrapper = container.querySelector(`.${expectedClass}`);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('.probe')).not.toBeNull();
  });

  it('produces no wrapper for width=normal (the explicit default)', () => {
    const { registry } = echoRegistry();
    const { container } = render(renderMark('::probe{width=normal}', registry));
    // No extra wrapping <div>: the probe element itself is the direct child.
    expect(container.firstElementChild).toHaveClass('probe');
    expect(container.querySelector('[class*="mk-width-"]')).toBeNull();
  });

  it.each([
    ['left', 'mk-align-left'],
    ['center', 'mk-align-center'],
    ['right', 'mk-align-right'],
  ])('wraps a block directive in a %s align class', (value, expectedClass) => {
    const { registry } = echoRegistry();
    const { container } = render(
      renderMark(`::probe{align=${value}}`, registry),
    );
    expect(container.querySelector(`.${expectedClass}`)).not.toBeNull();
  });

  it('combines width and align into one wrapper carrying both classes', () => {
    const { registry } = echoRegistry();
    const { container } = render(
      renderMark('::probe{width=wide align=center}', registry),
    );
    const wrapper = container.querySelector('.mk-width-wide.mk-align-center');
    expect(wrapper).not.toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    '"; }',
    '<script>alert(1)</script>',
    'WIDE',
    '',
  ])(
    'produces no wrapper for a hostile/invalid width value (%s), and never reaches the DOM',
    (value) => {
      const { registry } = echoRegistry();
      // Single-quoted directive attribute syntax (`{width='...'}`), so a value
      // containing a literal `"` (e.g. `"; }`) doesn't prematurely terminate
      // the attribute — mdast-util-directive accepts either quote style.
      const { container } = render(
        renderMark(`::probe{width='${value}'}`, registry),
      );
      expect(container.querySelector('[class*="mk-width-"]')).toBeNull();
      expect(container.innerHTML).not.toContain('<script>');
      expect(container.querySelector('script')).toBeNull();
    },
  );

  it('strips width/align from the attributes a registered component receives', () => {
    const { registry, seenAttributes } = echoRegistry();
    render(
      renderMark('::probe{width=wide align=center title="kept"}', registry),
    );
    expect(seenAttributes()).toEqual({ title: 'kept' });
  });

  it('strips width/align even when the value is invalid (interception wins regardless of validity)', () => {
    const { registry, seenAttributes } = echoRegistry();
    render(
      renderMark('::probe{width=bogus align=nope title="kept"}', registry),
    );
    expect(seenAttributes()).toEqual({ title: 'kept' });
  });

  it('strips reserved layout keys from an inline (text) directive but never wraps it', () => {
    const { container } = render(
      renderMark(':kbd[Ctrl+S]{align=center}', defaultRegistry),
    );
    // No layout class anywhere in the tree — an inline directive never gets
    // a wrapper, so the resolved class string is simply discarded.
    expect(container.querySelector('.mk-align-center')).toBeNull();
    expect(container.querySelector('[class*="mk-width-"]')).toBeNull();
    expect(container.querySelector('[class*="mk-align-"]')).toBeNull();
    const kbd = container.querySelector('kbd.mk-kbd');
    expect(kbd).not.toBeNull();
    expect(kbd).toHaveTextContent('Ctrl+S');
  });

  it('strips width/align from the attributes an inline registered component receives, with no wrapper div', () => {
    let seen: DirectiveAttributes | undefined;
    const registry: Registry = {
      probe: {
        component: ({ attributes }: MarkComponentProps) => {
          seen = attributes;
          return <span className="probe">x</span>;
        },
        inline: true,
      },
    };
    const { container } = render(
      renderMark(
        ':probe[hi]{width=narrow align=center title="kept"}',
        registry,
      ),
    );
    expect(seen).toEqual({ title: 'kept' });
    expect(container.querySelector('[class*="mk-width-"]')).toBeNull();
    expect(container.querySelector('[class*="mk-align-"]')).toBeNull();
    expect(container.querySelector('div')).toBeNull();
    expect(container.querySelector('.probe')).not.toBeNull();
  });

  it('still strips an invalid width/align value from an inline directive, with no wrapper and no class', () => {
    let seen: DirectiveAttributes | undefined;
    const registry: Registry = {
      probe: {
        component: ({ attributes }: MarkComponentProps) => {
          seen = attributes;
          return <span className="probe">x</span>;
        },
        inline: true,
      },
    };
    const { container } = render(
      renderMark(
        ":probe[hi]{width='javascript:alert(1)' align=constructor}",
        registry,
      ),
    );
    expect(seen).toEqual({});
    expect(container.querySelector('[class*="mk-width-"]')).toBeNull();
    expect(container.querySelector('[class*="mk-align-"]')).toBeNull();
    expect(container.querySelector('div')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('renders the inline unknown-directive fallback (no wrapper) for an inline unregistered directive carrying layout attrs, never throwing', () => {
    expect(() =>
      render(renderMark(':mystery[hi]{width=wide align=center}', {})),
    ).not.toThrow();
    const { container } = render(
      renderMark(':mystery[hi]{width=wide align=center}', {}),
    );
    expect(container.querySelector('[class*="mk-width-"]')).toBeNull();
    expect(container.querySelector('[class*="mk-align-"]')).toBeNull();
    expect(container.querySelector('div')).toBeNull();
    const fallback = container.querySelector('.mk-unknown--inline');
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent('mystery');
  });

  it('never throws for an inline directive carrying layout attributes', () => {
    expect(() =>
      render(
        renderMark(':kbd[Ctrl+S]{width=wide align=center}', defaultRegistry),
      ),
    ).not.toThrow();
  });

  it('still renders the unknown-directive fallback (wrapped) for an unregistered directive with width=wide, never throwing', () => {
    expect(() => render(renderMark('::mystery{width=wide}', {}))).not.toThrow();
    const { container } = render(renderMark('::mystery{width=wide}', {}));
    const wrapper = container.querySelector('.mk-width-wide');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('.mk-unknown')).not.toBeNull();
    expect(wrapper).toHaveTextContent('mystery');
  });

  it('still renders the fallback (wrapped) for a directive named constructor with width=wide, never throwing', () => {
    expect(() =>
      render(renderMark(':::constructor{width=wide}\nhi\n:::', {})),
    ).not.toThrow();
    const { container } = render(
      renderMark(':::constructor{width=wide}\nhi\n:::', {}),
    );
    const wrapper = container.querySelector('.mk-width-wide');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('.mk-unknown')).not.toBeNull();
    expect(wrapper).toHaveTextContent('constructor');
  });

  it('data= binding still resolves correctly alongside width=wide on the same directive', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh', ranAt: 1000 },
    });
    let seen: MarkComponentProps | undefined;
    const registry: Registry = {
      probe: {
        component: (props: MarkComponentProps) => {
          seen = props;
          return <div className="probe" />;
        },
        inline: false,
      },
    };
    const { container } = render(
      renderMark('::probe{width=wide data=stars}', registry, store),
    );
    expect(container.querySelector('.mk-width-wide .probe')).not.toBeNull();
    expect(seen?.data).toBe(42);
    expect(seen?.dataStatus).toBe('fresh');
    expect(seen?.attributes).toEqual({});
  });

  it('recognizes `:::tab{width=wide}` inside `::::tabs` as a tab (layout attrs on a directive Tabs reads by name do not break recognition)', () => {
    const { container } = render(
      renderMark(
        [
          '::::tabs',
          ':::tab{label="A" width=wide}',
          'panel A',
          ':::',
          ':::tab{label="B"}',
          'panel B',
          ':::',
          '::::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const buttons = container.querySelectorAll('.mk-tabs__button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('A');
    expect(buttons[1]).toHaveTextContent('B');
    expect(container.querySelector('.mk-tab')).toHaveTextContent('panel A');
  });
});

describe('renderMark — @-prefixed vault-scoped reads (docs/scripting.md)', () => {
  it(':value[@gh.stars] resolves from the vault when a vault is supplied', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: { stars: 42 }, status: 'fresh' } },
    });
    const { container } = render(
      renderMark(':value[@gh.stars]', defaultRegistry, undefined, vault),
    );
    expect(container.querySelector('.mk-value')).toHaveTextContent('42');
    expect(container.querySelector('.mk-value--missing')).toBeNull();
  });

  it(':value[@gh.stars] renders the missing marker with no vault supplied', () => {
    const { container } = render(
      renderMark(':value[@gh.stars]', defaultRegistry),
    );
    const missing = container.querySelector('.mk-value--missing');
    expect(missing).not.toBeNull();
    expect(missing).toHaveTextContent('{@gh.stars}');
  });

  it('data=@gh.stars resolves from the vault, not the note store', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: { stars: 7 }, status: 'fresh' } },
    });
    const store = createValueStore({
      gh: { value: { stars: 999 }, status: 'fresh' },
    });
    let seen: MarkComponentProps | undefined;
    const registry: Registry = {
      probe: {
        component: (props: MarkComponentProps) => {
          seen = props;
          return <div className="probe" />;
        },
        inline: false,
      },
    };
    render(renderMark('::probe{data=@gh.stars}', registry, store, vault));
    expect(seen?.data).toBe(7);
    expect(seen?.dataStatus).toBe('fresh');
  });

  it('a vault-stale value gets the stale class through :value[]', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: 41, status: 'stale' } },
    });
    const { container } = render(
      renderMark(':value[@gh]', defaultRegistry, undefined, vault),
    );
    const stale = container.querySelector('.mk-value--stale');
    expect(stale).not.toBeNull();
    expect(stale).toHaveTextContent('41');
  });

  it(':value[@] renders the missing marker without throwing', () => {
    expect(() =>
      render(renderMark(':value[@]', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(renderMark(':value[@]', defaultRegistry));
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });

  it(':value[@__proto__] renders the missing marker without throwing', () => {
    const { store: vault } = createVaultStore();
    expect(() =>
      render(
        renderMark(':value[@__proto__]', defaultRegistry, undefined, vault),
      ),
    ).not.toThrow();
    const { container } = render(
      renderMark(':value[@__proto__]', defaultRegistry, undefined, vault),
    );
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });
});

describe('renderMark — backward compatibility and render purity', () => {
  it('the 3-arg call (no vault) still resolves bare data=/:value[] names exactly as before', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh', ranAt: 1000 },
    });
    let seen: MarkComponentProps | undefined;
    const registry: Registry = {
      probe: {
        component: (props: MarkComponentProps) => {
          seen = props;
          return <div className="probe" />;
        },
        inline: false,
      },
    };
    const { container } = render(
      renderMark('::probe{data=stars}\n\n:value[stars]', registry, store),
    );
    expect(seen?.data).toBe(42);
    expect(seen?.dataStatus).toBe('fresh');
    expect(container.querySelector('.mk-value')).toHaveTextContent('42');
  });

  it('rendering a document that reads data=@x and :value[@y] never writes the vault', () => {
    const { store: vault } = createVaultStore({
      initial: {
        x: { value: 1, status: 'fresh' },
        y: { value: 2, status: 'fresh' },
      },
    });
    const before = vault.snapshot();
    let seen: MarkComponentProps | undefined;
    const registry: Registry = {
      probe: {
        component: (props: MarkComponentProps) => {
          seen = props;
          return <div className="probe" />;
        },
        inline: false,
      },
    };
    render(
      renderMark('::probe{data=@x}\n\n:value[@y]', registry, undefined, vault),
    );
    expect(seen?.data).toBe(1);
    expect(vault.snapshot()).toEqual(before);
  });
});

// URL-sanitization behavior is a `toHast` (@markii/core) concern and is tested
// at the hast level in @markii/core's `to-hast.test.ts` — no React/jsdom
// involved there. This file only covers React-facing rendering behavior.

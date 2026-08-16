import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forwardRef, memo } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { conformanceDir } from '@markii/core/corpus';
import { createValueStore } from '@markii/runtime';
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
    expect(inlineFallback).toHaveTextContent('badge');

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
});

describe('renderMark — collapsed script marker (DESIGN.md §8)', () => {
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

// URL-sanitization behavior is a `toHast` (@markii/core) concern and is tested
// at the hast level in @markii/core's `to-hast.test.ts` — no React/jsdom
// involved there. This file only covers React-facing rendering behavior.

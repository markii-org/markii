import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformanceDir, listCorpusNames } from '@markii/core/corpus';
import { renderMarkToHtml } from './render.js';
import { defaultHtmlRegistry } from './components/index.js';

/**
 * Issue #2's success criterion for `@markii/html`: the L1 conformance corpus
 * (`conformance/*.mk.md`, docs/spec.md §13 — the same language-agnostic
 * fixtures `@markii/core`'s parser tests and `@markii/react`'s `render.test.tsx`
 * both run against) renders through this engine too. The corpus is
 * PARSER-level, not renderer-level, so its `.json` siblings describe the
 * mdast AST, not any renderer's HTML/DOM output — there is no
 * renderer-agnostic expected-HTML fixture to diff against here. What this
 * suite asserts, for every fixture, is the contract `@markii/html` itself
 * promises regardless of content: `renderMarkToHtml` never throws and
 * produces a non-empty string. A handful of fixtures also get a targeted
 * structural assertion, mirroring the specific checks
 * `@markii/react`'s own corpus-backed tests make.
 */

function readFixture(name: string): string {
  return readFileSync(join(conformanceDir(), name), 'utf8');
}

const FIXTURE_NAMES = [
  '01-plain-markdown.mk.md',
  '02-inline-directive.mk.md',
  '03-leaf-directive.mk.md',
  '04-container-directive.mk.md',
  '05-attributes.mk.md',
  '06-nested-directives.mk.md',
  '07-unknown-directive.mk.md',
  '08-code-fence.mk.md',
  '09-malformed-container.mk.md',
  '10-prototype-names.mk.md',
  '11-script-block.mk.md',
  '12-gfm-table.mk.md',
  '13-task-list.mk.md',
  '14-strikethrough.mk.md',
  '15-layout-attributes.mk.md',
  '16-script-name-charset.mk.md',
  '17-fence-meta-grammar.mk.md',
  '18-layout-wrappers.mk.md',
  '19-frontmatter.mk.md',
  '20-frontmatter-block-list.mk.md',
  '21-frontmatter-unclosed.mk.md',
  '22-frontmatter-not-at-start.mk.md',
  '23-thematic-break-mid-document.mk.md',
  '24-nested-containers.mk.md',
  '25-container-auto-close-by-parent-fence.mk.md',
  '26-container-same-colon-nesting.mk.md',
  '27-row-align-left-wrapper.mk.md',
  '28-text-directive-word-start.mk.md',
  '29-raw-html.mk.md',
  '30-directive-name-colon-rejected.mk.md',
  '31-malformed-leaf-attributes.mk.md',
];

describe('conformance corpus renders through @markii/html', () => {
  it('the fixture list above accounts for every *.mk.md file in conformance/ (nothing silently skipped)', () => {
    const actual = listCorpusNames();
    expect(actual).toEqual(
      FIXTURE_NAMES.map((n) => n.replace(/\.mk\.md$/, '')),
    );
  });

  for (const name of FIXTURE_NAMES) {
    it(`renders ${name} without throwing, producing non-empty HTML`, () => {
      const source = readFixture(name);
      let html = '';
      expect(() => {
        html = renderMarkToHtml(source, defaultHtmlRegistry);
      }).not.toThrow();
      expect(html.length).toBeGreaterThan(0);
      // The generic "failed to render document" fallback must never fire for
      // a corpus fixture — every one of these is well-formed input, however
      // unusual (malformed containers, prototype-name directives, ...).
      expect(html).not.toContain('failed to render document');
    });
  }

  it('01-plain-markdown: ordinary markdown passes through untouched', () => {
    const html = renderMarkToHtml(
      readFixture('01-plain-markdown.mk.md'),
      defaultHtmlRegistry,
    );
    expect(html).toContain('<h1>');
    expect(html).toContain('<li>');
  });

  it('02-inline-directive: the built-in kbd renders for inline text directives', () => {
    const html = renderMarkToHtml(
      readFixture('02-inline-directive.mk.md'),
      defaultHtmlRegistry,
    );
    expect(html).toContain('<kbd class="mk-kbd"');
  });

  it('04-container-directive: the built-in callout renders for a container directive', () => {
    const html = renderMarkToHtml(
      readFixture('04-container-directive.mk.md'),
      defaultHtmlRegistry,
    );
    expect(html).toContain('mk-callout');
  });

  it('07-unknown-directive: an unregistered name degrades to the fallback box, never throws', () => {
    const html = renderMarkToHtml(
      readFixture('07-unknown-directive.mk.md'),
      defaultHtmlRegistry,
    );
    expect(html).toContain('mk-unknown');
  });

  it('09-malformed-container: malformed directive syntax never throws', () => {
    expect(() =>
      renderMarkToHtml(
        readFixture('09-malformed-container.mk.md'),
        defaultHtmlRegistry,
      ),
    ).not.toThrow();
  });

  it('10-prototype-names: a directive named after an Object.prototype member renders the fallback, never a prototype member', () => {
    const html = renderMarkToHtml(
      readFixture('10-prototype-names.mk.md'),
      defaultHtmlRegistry,
    );
    expect(html).not.toContain('[object');
  });

  it('11-script-block: the fence folds into a collapsed script marker, and its stat-card directive degrades to the unknown fallback (not a registered name)', () => {
    const html = renderMarkToHtml(
      readFixture('11-script-block.mk.md'),
      defaultHtmlRegistry,
    );
    expect(html).toContain('<details class="mk-script">');
    expect(html).toContain('unknown component <code>stat-card</code>');
  });

  it('12-gfm-table: a GFM table renders as an ordinary <table>', () => {
    const html = renderMarkToHtml(
      readFixture('12-gfm-table.mk.md'),
      defaultHtmlRegistry,
    );
    expect(html).toContain('<table>');
  });

  it('19-frontmatter: the frontmatter block is dropped from the rendered output', () => {
    const html = renderMarkToHtml(
      readFixture('19-frontmatter.mk.md'),
      defaultHtmlRegistry,
    );
    expect(html).not.toContain('title: Release notes');
    expect(html).toContain('mk-callout');
  });
});

/**
 * The RENDER-level fixture set (`conformance/render/`, issue-driven by this
 * change): unlike the parser-level corpus above, these pairs commit the
 * exact expected HTML string `@markii/html` emits, not an mdast AST — so a
 * markup/class regression in the fallback boxes, the layout wrapper, the
 * missing-value marker, or `::table`'s empty state fails a byte-level diff
 * here, not just a "did it throw" smoke check. Every fixture renders with
 * NO value store (matching how `04-value-failure`/`05-table` were
 * authored): a `data=`/`:value[...]` binding is deliberately left unbound so
 * the fixture captures the quiet MISSING/empty presentation, which is
 * itself part of what this set is guarding.
 *
 * Naming/loading follows `@markii/core`'s top-level corpus convention
 * (`corpus.ts`'s `<name>.mk.md` + sibling, sorted, nothing silently
 * skipped) — just with an `.html` sibling extension instead of `.json`,
 * since the expected artifact here is rendered markup, not an AST.
 *
 * Normalization: NONE beyond stripping a single trailing newline from each
 * side, so the `.html` fixture files can end (or not end) in a newline
 * without that being part of the comparison. No HTML parsing, attribute
 * reordering, or whitespace collapsing is applied — the fixtures are
 * expected to match byte-for-byte otherwise, and `@markii/react`'s own test
 * (`render.test.tsx`'s "render fixtures" suite) asserts the same class
 * names and structure for the identical inputs so the two engines cannot
 * drift apart unnoticed.
 */
describe('render-level conformance fixtures (conformance/render/)', () => {
  const renderFixturesDir = join(conformanceDir(), 'render');
  const RENDER_FIXTURE_EXTENSION = '.mk.md';

  function listRenderFixtureNames(): string[] {
    return readdirSync(renderFixturesDir)
      .filter((entry) => entry.endsWith(RENDER_FIXTURE_EXTENSION))
      .map((entry) => entry.slice(0, -RENDER_FIXTURE_EXTENSION.length))
      .sort();
  }

  const RENDER_FIXTURE_NAMES = [
    '01-unknown-component',
    '02-form-mismatch',
    '03-layout-attributes',
    '04-value-failure',
    '05-table',
  ];

  it('the fixture list above accounts for every *.mk.md file in conformance/render/ (nothing silently skipped)', () => {
    expect(listRenderFixtureNames()).toEqual(RENDER_FIXTURE_NAMES);
  });

  for (const name of RENDER_FIXTURE_NAMES) {
    it(`${name}: renders exactly the committed expected HTML`, () => {
      const input = readFileSync(
        join(renderFixturesDir, `${name}.mk.md`),
        'utf8',
      );
      const expectedHtml = readFileSync(
        join(renderFixturesDir, `${name}.html`),
        'utf8',
      );
      const html = renderMarkToHtml(input, defaultHtmlRegistry);
      // The only normalization applied — see this describe block's doc
      // comment.
      expect(html.replace(/\n$/, '')).toBe(expectedHtml.replace(/\n$/, ''));
    });
  }
});

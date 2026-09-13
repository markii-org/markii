import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformanceDir, listCorpusNames } from '@markii/core/corpus';
import { renderMarkToAnsi } from './render.js';
import { defaultAnsiRegistry } from './components/index.js';

/**
 * Mirrors `@markii/html`'s `conformance.test.ts` for the terminal engine
 * (batch 9, phase 2's success criterion): the L1 conformance corpus
 * (`conformance/*.mk.md`) renders through `renderMarkToAnsi` without
 * throwing, and produces a non-empty string. The corpus is PARSER-level,
 * not renderer-level, so there is no renderer-agnostic expected-text
 * fixture to diff against here.
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
  '32-script-permissions.mk.md',
];

describe('conformance corpus renders through @markii/ansi', () => {
  it('the fixture list above accounts for every *.mk.md file in conformance/ (nothing silently skipped)', () => {
    const actual = listCorpusNames();
    expect(actual).toEqual(
      FIXTURE_NAMES.map((n) => n.replace(/\.mk\.md$/, '')),
    );
  });

  for (const name of FIXTURE_NAMES) {
    it(`renders ${name} without throwing, producing non-empty text`, () => {
      const source = readFixture(name);
      let text = '';
      expect(() => {
        text = renderMarkToAnsi(source, defaultAnsiRegistry);
      }).not.toThrow();
      expect(text.length).toBeGreaterThan(0);
      // The generic "failed to render document" fallback must never fire
      // for a corpus fixture.
      expect(text).not.toContain('failed to render document');
    });
  }
});

/**
 * The RENDER-level fixture set (`conformance/render/`), mirroring
 * `@markii/html`'s identical describe block: each `<name>.mk.md` gets a
 * committed `<name>.txt` this engine's output must byte-match (rendered at
 * width 80, color `'never'`), plus one `.ansi` sibling for the FIRST fixture
 * (`01-unknown-component`), rendered at `'truecolor'`, to lock the escape
 * sequences this engine emits. Normalization: a single trailing newline is
 * stripped from each side before comparing, matching every other engine's
 * conformance suite. Fixtures render with no value store, same as
 * `@markii/html`'s — a `data=`/`:value[...]` binding is deliberately left
 * unbound so the fixture captures the quiet MISSING/empty presentation.
 * `packages/platforms/markii-ansi/scripts/regenerate-ansi-fixtures.ts`
 * regenerates the `.txt`/`.ansi` files; it is never run automatically.
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
    '06-image',
    '07-notice',
    '08-row-cards',
  ];

  it('the fixture list above accounts for every *.mk.md file in conformance/render/ (nothing silently skipped)', () => {
    expect(listRenderFixtureNames()).toEqual(RENDER_FIXTURE_NAMES);
  });

  for (const name of RENDER_FIXTURE_NAMES) {
    it(`${name}: renders exactly the committed expected text (width 80, color 'never')`, () => {
      const input = readFileSync(
        join(renderFixturesDir, `${name}.mk.md`),
        'utf8',
      );
      const expectedText = readFileSync(
        join(renderFixturesDir, `${name}.txt`),
        'utf8',
      );
      const text = renderMarkToAnsi(
        input,
        defaultAnsiRegistry,
        undefined,
        undefined,
        {
          width: 80,
          color: 'never',
        },
      );
      expect(text.replace(/\n$/, '')).toBe(expectedText.replace(/\n$/, ''));
    });
  }

  it("01-unknown-component WITH color 'truecolor': renders exactly the committed expected escape sequences", () => {
    const input = readFileSync(
      join(renderFixturesDir, '01-unknown-component.mk.md'),
      'utf8',
    );
    const expectedAnsi = readFileSync(
      join(renderFixturesDir, '01-unknown-component.ansi'),
      'utf8',
    );
    const text = renderMarkToAnsi(
      input,
      defaultAnsiRegistry,
      undefined,
      undefined,
      {
        width: 80,
        color: 'truecolor',
      },
    );
    expect(text.replace(/\n$/, '')).toBe(expectedAnsi.replace(/\n$/, ''));
  });
});

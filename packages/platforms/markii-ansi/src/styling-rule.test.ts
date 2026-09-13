import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformanceDir } from '@markii/core/corpus';
import { renderMarkToAnsi } from './render.js';
import { defaultAnsiRegistry } from './components/index.js';

/**
 * Proves the batch-10 styling rule (AGENTS.md, this batch's binding
 * orchestrator decision): this engine never touches Ink's own color/style
 * props or `chalk.level` — every escape it emits comes from `./ansi.js`'s
 * own SGR helpers, applied to a plain string BEFORE that string ever
 * reaches a `<Text>` node. Two consequences are directly testable and are
 * the two tests the brief asks for:
 *
 * 1. A `color: 'never'` render carries NO ESC byte (0x1b) at all, for every
 *    committed render-level fixture — not just "no SGR", literally no ESC
 *    byte of any kind, since there is nothing in this engine's own pipeline
 *    that would ever emit one at that level.
 * 2. Two renders at different color levels, in the SAME process, each get
 *    their own correct escapes with no cross-talk — proving this engine
 *    carries no hidden global color state (unlike `chalk.level`, a
 *    module-level singleton the brief forbids touching for exactly this
 *    reason: a shared mutable level cannot serve two callers at different
 *    levels correctly).
 */

const ESC = '\x1b';

describe('styling rule: no Ink color props, no chalk.level, no hidden global state', () => {
  const renderFixturesDir = join(conformanceDir(), 'render');
  const fixtureNames = readdirSync(renderFixturesDir)
    .filter((entry) => entry.endsWith('.mk.md'))
    .map((entry) => entry.slice(0, -'.mk.md'.length))
    .sort();

  it('accounts for at least one fixture (sanity: the glob actually found files)', () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
  });

  for (const name of fixtureNames) {
    it(`${name}: a color 'never' render contains no ESC byte (0x1b) at all`, async () => {
      const input = readFileSync(
        join(renderFixturesDir, `${name}.mk.md`),
        'utf8',
      );
      const text = await renderMarkToAnsi(
        input,
        defaultAnsiRegistry,
        undefined,
        undefined,
        {
          width: 80,
          color: 'never',
        },
      );
      expect(text.includes(ESC)).toBe(false);
    });
  }

  it('two renders at different color levels in the same process each get their own correct escapes, with no cross-talk', async () => {
    const source = ':badge[New]{variant=success}\n';

    const none = await renderMarkToAnsi(
      source,
      defaultAnsiRegistry,
      undefined,
      undefined,
      {
        color: 'never',
      },
    );
    const sixteen = await renderMarkToAnsi(
      source,
      defaultAnsiRegistry,
      undefined,
      undefined,
      {
        color: '16',
      },
    );
    const truecolor = await renderMarkToAnsi(
      source,
      defaultAnsiRegistry,
      undefined,
      undefined,
      {
        color: 'truecolor',
      },
    );

    expect(none.includes(ESC)).toBe(false);
    // '16' uses a plain SGR code (30-37/90-97 range), never a 256/truecolor sequence.
    expect(sixteen).toMatch(/\x1b\[7m/);
    expect(sixteen).not.toMatch(/38;2;|38;5;/);
    // truecolor uses the 38;2;r;g;b form.
    expect(truecolor).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);

    // Re-render 'never' again AFTER the truecolor render, in the same
    // process: still no escape, proving the truecolor render left no
    // process-wide state behind that a later 'never' render could inherit.
    const noneAgain = await renderMarkToAnsi(
      source,
      defaultAnsiRegistry,
      undefined,
      undefined,
      {
        color: 'never',
      },
    );
    expect(noneAgain.includes(ESC)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  lintPackCss,
  lintPackCssColors,
  lintPackCssPrefix,
} from './pack-css-lint.js';

describe('lintPackCssColors', () => {
  it('does not warn when the var() fallback is itself a function call', () => {
    // A naive fallback-stripping pattern stops at the inner `(` and leaves
    // the literal exposed. Caught on a real pack: `--mk-shadow-sm`'s
    // documented fallback is an `rgba()` call.
    expect(
      lintPackCssColors(
        'cat',
        '.mk-cat_badge { background: var(--mk-shadow-sm, rgba(0, 0, 0, 0.05)); }',
      ),
    ).toEqual([]);
  });

  it('still warns on a real literal alongside a function-call fallback', () => {
    const warnings = lintPackCssColors(
      'cat',
      '.mk-cat_badge { box-shadow: 0 0 0 1px var(--mk-border, rgba(0,0,0,.1)), 0 1px 0 #ff0000; }',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('#ff0000');
  });

  it('does not warn on a literal used as a var() fallback', () => {
    // `var(--token, #hex)` still follows the palette wherever the palette
    // exists; the fallback is what keeps a pack readable against an older
    // doc.css that predates the token, and docs/integration.md recommends
    // exactly this shape. Flagging it would contradict the guidance.
    expect(
      lintPackCssColors(
        'hn',
        '.mk-hn_row { border-color: var(--mk-border, #e4e4e7); }',
      ),
    ).toEqual([]);
  });

  it('still warns when a hardcoded color sits beside a var() fallback', () => {
    // Only the fallback argument is exempt. A second, genuinely hardcoded
    // color in the same declaration must still be caught.
    const warnings = lintPackCssColors(
      'hn',
      '.mk-hn_row { box-shadow: 0 0 0 1px var(--mk-border, #e4e4e7), 0 1px 0 #ff0000; }',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('#ff0000');
  });

  it('warns on a hex color literal', () => {
    const warnings = lintPackCssColors(
      'hn',
      '.mk-hn_row { background: #fef08a; }',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('pack "hn"');
    expect(warnings[0]).toContain('background: #fef08a;');
  });

  it('warns on rgb(), rgba(), hsl(), and hsla() literals', () => {
    const css = `
      .mk-hn_a { color: rgb(255, 0, 0); }
      .mk-hn_b { color: rgba(255, 0, 0, 0.5); }
      .mk-hn_c { color: hsl(10, 50%, 50%); }
      .mk-hn_d { color: hsla(10, 50%, 50%, 0.5); }
    `;
    expect(lintPackCssColors('hn', css)).toHaveLength(4);
  });

  it('does not warn on transparent, currentColor, or inherit', () => {
    const css = `
      .mk-hn_a { border-color: transparent; }
      .mk-hn_b { color: currentColor; }
      .mk-hn_c { color: inherit; }
    `;
    expect(lintPackCssColors('hn', css)).toEqual([]);
  });

  it('does not warn on a declaration using an --mk-* token', () => {
    const css =
      '.mk-hn_row { color: var(--mk-fg); background: var(--mk-surface); }';
    expect(lintPackCssColors('hn', css)).toEqual([]);
  });

  it('does not warn on a non-color declaration', () => {
    const css = '.mk-hn_row { display: flex; padding: 4px 8px; }';
    expect(lintPackCssColors('hn', css)).toEqual([]);
  });

  it('names the pack and the exact offending declaration for multiple hits', () => {
    const css =
      '.mk-hn_a { background: #111; } .mk-hn_b { border: 1px solid #222; }';
    const warnings = lintPackCssColors('hn', css);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('background: #111;');
    expect(warnings[1]).toContain('border: 1px solid #222;');
  });
});

describe('lintPackCssPrefix', () => {
  it('does not warn when every class selector carries the pack prefix', () => {
    const css =
      '.mk-hn_row { display: flex; } .mk-hn_row:hover { opacity: 0.8; }';
    expect(lintPackCssPrefix('hn', css)).toEqual([]);
  });

  it('warns on a selector missing the prefix', () => {
    const warnings = lintPackCssPrefix('hn', '.row { display: flex; }');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('pack "hn"');
    expect(warnings[0]).toContain('.row');
    expect(warnings[0]).toContain('.mk-hn_');
  });

  it('warns on a selector prefixed for a DIFFERENT pack', () => {
    const warnings = lintPackCssPrefix(
      'hn',
      '.mk-other_row { display: flex; }',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.mk-other_row');
  });

  it('checks every comma-separated selector in a list independently', () => {
    const warnings = lintPackCssPrefix(
      'hn',
      '.mk-hn_row, .row, .mk-hn_cell { color: red; }',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('".row"');
  });

  it('checks nested selectors inside an @media block', () => {
    const warnings = lintPackCssPrefix(
      'hn',
      '@media (max-width: 600px) { .row { display: block; } }',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.row');
  });

  it('does not warn on a correctly prefixed selector inside @media', () => {
    const css = '@media (max-width: 600px) { .mk-hn_row { display: block; } }';
    expect(lintPackCssPrefix('hn', css)).toEqual([]);
  });

  it('does not warn on @keyframes percentage/from/to selectors', () => {
    const css = `
      @keyframes mk-hn-spin {
        0% { opacity: 0; }
        from { transform: none; }
        to { transform: rotate(360deg); }
      }
    `;
    expect(lintPackCssPrefix('hn', css)).toEqual([]);
  });

  it('does not warn on a non-class selector (element, attribute, pseudo-root)', () => {
    const css =
      ':root { --mk-hn-local: 1px; } [data-mk-hn]::before { content: ""; }';
    expect(lintPackCssPrefix('hn', css)).toEqual([]);
  });
});

describe('esbuild source-banner comments', () => {
  it('a leading /* source path */ banner comment does not hide the prefix warning on the next selector', () => {
    const css = '/* packs/badcss/Stat.css */\n.stat {\n  color: #123456;\n}\n';
    const warnings = lintPackCss('badcss', css);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes('raw color literal'))).toBe(true);
    expect(warnings.some((w) => w.includes('required prefix'))).toBe(true);
  });

  it('a banner comment does not hide a color literal inside a comment being mistaken for real, nor swallow real content', () => {
    const css =
      '/* some/path.css */\n.mk-hn_row { color: var(--mk-fg); }\n/* another/path.css */\n.row { color: #fff; }\n';
    const warnings = lintPackCssPrefix('hn', css);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.row');
  });
});

describe('lintPackCss', () => {
  it('combines both rules, colors first', () => {
    const warnings = lintPackCss('hn', '.row { background: #fff; }');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('raw color literal');
    expect(warnings[1]).toContain('required prefix');
  });

  it('is empty for clean, correctly prefixed, token-based CSS', () => {
    const css =
      '.mk-hn_row { color: var(--mk-fg); background: var(--mk-surface); }';
    expect(lintPackCss('hn', css)).toEqual([]);
  });
});

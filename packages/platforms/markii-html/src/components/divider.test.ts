import { describe, expect, it } from 'vitest';
import { createTestContext } from '../test/html-context.js';
import { renderMarkToHtml } from '../render.js';
import { Divider } from './divider.js';
import { defaultHtmlRegistry } from './index.js';

const ctx = createTestContext();

describe('Divider', () => {
  it('renders the default (no attributes) line divider', () => {
    expect(Divider({}, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line" role="separator"></div>',
    );
  });

  it('renders a labeled line divider with aria-label and label span', () => {
    expect(Divider({ label: 'Part 2' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });

  it('applies the dots modifier class', () => {
    expect(Divider({ variant: 'dots' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--dots" role="separator"></div>',
    );
  });

  it('dots variant with a label behaves the same as line, just a different class', () => {
    expect(Divider({ variant: 'dots', label: 'X' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--dots" role="separator" aria-label="X">' +
        '<span class="mk-divider__label">X</span></div>',
    );
  });

  it('ornament variant without a label renders a single ornament span', () => {
    expect(Divider({ variant: 'ornament' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--ornament" role="separator">' +
        '<span class="mk-divider__ornament" aria-hidden="true">❖</span></div>',
    );
  });

  it('ornament variant with a label renders ornament, label, ornament', () => {
    expect(Divider({ variant: 'ornament', label: 'Part 2' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--ornament" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__ornament" aria-hidden="true">❖</span>' +
        '<span class="mk-divider__label">Part 2</span>' +
        '<span class="mk-divider__ornament" aria-hidden="true">❖</span></div>',
    );
  });

  it('falls back to line for an invalid variant value, never throwing', () => {
    expect(() => Divider({ variant: 'wobble' }, '', ctx)).not.toThrow();
    expect(Divider({ variant: 'wobble' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line" role="separator"></div>',
    );
  });

  it('falls back to line for a bare {variant} (null value)', () => {
    expect(Divider({ variant: null }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line" role="separator"></div>',
    );
  });

  it('treats an empty label as absent: no span, no aria-label', () => {
    expect(Divider({ label: '' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line" role="separator"></div>',
    );
  });

  it('escapes a hostile label in both the aria-label attribute and the label text', () => {
    const html = Divider({ label: '"><script>alert(1)</script>' }, '', ctx);
    expect(html).not.toContain('<script>');
    expect(html).toContain(
      'aria-label="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
    );
    expect(html).toContain(
      '<span class="mk-divider__label">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</span>',
    );
  });

  it('renders through the full pipeline via renderMarkToHtml, proving registration', () => {
    const html = renderMarkToHtml(
      '::divider{label="Part 2"}\n',
      defaultHtmlRegistry,
    );
    expect(html).toContain(
      '<div class="mk-divider mk-divider--line" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });

  it('written inline as a text directive degrades to the inline mismatch fallback', () => {
    const html = renderMarkToHtml(':divider[x]\n', defaultHtmlRegistry);
    expect(html).toContain('mk-unknown--inline mk-unknown--mismatch');
    expect(html).toContain(
      'block component <code>divider</code> written inline',
    );
  });
});

describe('Divider — label-align', () => {
  it('adds no modifier class for label-align=center (the default value written explicitly)', () => {
    expect(Divider({ label: 'Part 2', 'label-align': 'center' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });

  it('adds no modifier class when label-align is absent', () => {
    expect(Divider({ label: 'Part 2' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });

  it('adds mk-divider--label-left for label-align=left', () => {
    expect(Divider({ label: 'Part 2', 'label-align': 'left' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line mk-divider--label-left" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });

  it('adds mk-divider--label-right for label-align=right', () => {
    expect(Divider({ label: 'Part 2', 'label-align': 'right' }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line mk-divider--label-right" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });

  it('combines with a non-default variant, in variant-then-label-align order', () => {
    expect(
      Divider(
        { label: 'Part 2', variant: 'dots', 'label-align': 'right' },
        '',
        ctx,
      ),
    ).toBe(
      '<div class="mk-divider mk-divider--dots mk-divider--label-right" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });

  it('falls back to center for an unrecognized label-align value, never throwing', () => {
    expect(() =>
      Divider({ label: 'Part 2', 'label-align': 'sideways' }, '', ctx),
    ).not.toThrow();
    expect(
      Divider({ label: 'Part 2', 'label-align': 'sideways' }, '', ctx),
    ).toBe(
      '<div class="mk-divider mk-divider--line" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });

  it('falls back to center for a bare {label-align} (null value)', () => {
    expect(Divider({ label: 'Part 2', 'label-align': null }, '', ctx)).toBe(
      '<div class="mk-divider mk-divider--line" role="separator" aria-label="Part 2">' +
        '<span class="mk-divider__label">Part 2</span></div>',
    );
  });
});

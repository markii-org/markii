import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

function html(source: string): HTMLElement {
  return render(renderMark(source, defaultRegistry)).container;
}

describe('Divider', () => {
  it('renders the default line variant with no label and no aria-label', () => {
    const container = html('::divider{}');
    const divider = container.querySelector('.mk-divider');
    expect(divider).not.toBeNull();
    expect(divider?.className).toBe('mk-divider mk-divider--line');
    expect(divider?.getAttribute('role')).toBe('separator');
    expect(divider?.hasAttribute('aria-label')).toBe(false);
    expect(divider?.querySelector('.mk-divider__label')).toBeNull();
  });

  it('renders a label span and sets aria-label when label is present', () => {
    const container = html('::divider{label="Part 2"}');
    const divider = container.querySelector('.mk-divider');
    expect(divider?.getAttribute('aria-label')).toBe('Part 2');
    expect(divider?.querySelector('.mk-divider__label')).toHaveTextContent(
      'Part 2',
    );
  });

  it('applies the dots modifier class for variant=dots', () => {
    const container = html('::divider{variant="dots"}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--dots',
    );
  });

  it('applies the ornament modifier class for variant=ornament', () => {
    const container = html('::divider{variant="ornament"}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--ornament',
    );
  });

  it('renders exactly one ornament span when there is no label', () => {
    const container = html('::divider{variant="ornament"}');
    const ornaments = container.querySelectorAll('.mk-divider__ornament');
    expect(ornaments).toHaveLength(1);
    expect(container.querySelector('.mk-divider__label')).toBeNull();
  });

  it('renders two ornament spans flanking the label span, in order', () => {
    const container = html('::divider{label="Part 2" variant="ornament"}');
    const divider = container.querySelector('.mk-divider');
    const children = divider ? [...divider.children] : [];
    expect(children).toHaveLength(3);
    expect(children[0]?.className).toBe('mk-divider__ornament');
    expect(children[1]?.className).toBe('mk-divider__label');
    expect(children[2]?.className).toBe('mk-divider__ornament');
  });

  it('falls back to line for an invalid variant value, never throwing', () => {
    expect(() => html('::divider{variant="wobble"}')).not.toThrow();
    const container = html('::divider{variant="wobble"}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--line',
    );
  });

  it('falls back to line for a bare {variant} attribute (null value), never throwing', () => {
    expect(() => html('::divider{variant}')).not.toThrow();
    const container = html('::divider{variant}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--line',
    );
  });

  it('treats an empty label="" as absent: no label span, no aria-label', () => {
    const container = html('::divider{label=""}');
    const divider = container.querySelector('.mk-divider');
    expect(divider?.hasAttribute('aria-label')).toBe(false);
    expect(divider?.querySelector('.mk-divider__label')).toBeNull();
  });
});

describe('Divider — label-align', () => {
  it('adds no modifier class for label-align=center (the default value written explicitly)', () => {
    const container = html('::divider{label="Part 2" label-align="center"}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--line',
    );
  });

  it('adds no modifier class when label-align is absent', () => {
    const container = html('::divider{label="Part 2"}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--line',
    );
  });

  it('adds mk-divider--label-left for label-align=left', () => {
    const container = html('::divider{label="Part 2" label-align="left"}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--line mk-divider--label-left',
    );
  });

  it('adds mk-divider--label-right for label-align=right', () => {
    const container = html('::divider{label="Part 2" label-align="right"}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--line mk-divider--label-right',
    );
  });

  it('combines with a non-default variant, in variant-then-label-align order', () => {
    const container = html(
      '::divider{label="Part 2" variant="dots" label-align="right"}',
    );
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--dots mk-divider--label-right',
    );
  });

  it('falls back to center for an unrecognized label-align value, never throwing', () => {
    expect(() =>
      html('::divider{label="Part 2" label-align="sideways"}'),
    ).not.toThrow();
    const container = html('::divider{label="Part 2" label-align="sideways"}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--line',
    );
  });

  it('falls back to center for a bare {label-align} attribute (null value), never throwing', () => {
    expect(() => html('::divider{label="Part 2" label-align}')).not.toThrow();
    const container = html('::divider{label="Part 2" label-align}');
    expect(container.querySelector('.mk-divider')?.className).toBe(
      'mk-divider mk-divider--line',
    );
  });
});

describe('Divider — form/kind mismatch', () => {
  it('degrades to the inline fallback instead of rendering when written inline', () => {
    const container = html(':divider[x]');
    expect(container.querySelector('.mk-divider')).toBeNull();
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback?.tagName).toBe('SPAN');
    expect(fallback?.className).toBe(
      'mk-unknown mk-unknown--inline mk-unknown--mismatch',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('Figure', () => {
  it('renders the image and caption for a safe https src', () => {
    const { container } = render(
      renderMark(
        ':::figure{src="https://example.com/cat.png" alt="A cat"}\nA cat, napping.\n:::',
        defaultRegistry,
      ),
    );
    const figure = container.querySelector('figure.mk-figure');
    expect(figure).not.toBeNull();
    const img = figure?.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.com/cat.png');
    expect(img).toHaveAttribute('alt', 'A cat');
    expect(figure?.querySelector('figcaption')).toHaveTextContent(
      'A cat, napping.',
    );
  });

  it('renders the image for a safe relative src', () => {
    const { container } = render(
      renderMark(
        ':::figure{src="assets/cat.png"}\ncaption\n:::',
        defaultRegistry,
      ),
    );
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'assets/cat.png',
    );
  });

  it('defaults alt to the empty string when absent', () => {
    const { container } = render(
      renderMark(
        ':::figure{src="https://example.com/cat.png"}\ncaption\n:::',
        defaultRegistry,
      ),
    );
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('SECURITY: drops a javascript: src rather than rendering it into the DOM', () => {
    expect(() =>
      render(
        renderMark(
          ':::figure{src="javascript:alert(1)"}\ncaption\n:::',
          defaultRegistry,
        ),
      ),
    ).not.toThrow();

    const { container } = render(
      renderMark(
        ':::figure{src="javascript:alert(1)"}\ncaption\n:::',
        defaultRegistry,
      ),
    );
    const figure = container.querySelector('figure.mk-figure');
    expect(figure).not.toBeNull();
    // No <img> at all — never an <img> whose src holds the hostile scheme.
    expect(figure?.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    // The caption still renders — dropping the image is not the whole
    // directive failing.
    expect(figure?.querySelector('figcaption')).toHaveTextContent('caption');
  });

  it('SECURITY: drops a data:text/html src the same way', () => {
    const { container } = render(
      renderMark(
        ':::figure{src="data:text/html,<script>alert(1)</script>"}\ncaption\n:::',
        defaultRegistry,
      ),
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders no image (but still the caption) when src is missing entirely', () => {
    const { container } = render(
      renderMark(':::figure\ncaption only\n:::', defaultRegistry),
    );
    const figure = container.querySelector('figure.mk-figure');
    expect(figure?.querySelector('img')).toBeNull();
    expect(figure?.querySelector('figcaption')).toHaveTextContent(
      'caption only',
    );
  });
});

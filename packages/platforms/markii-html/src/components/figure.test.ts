import { describe, expect, it } from 'vitest';
import { createTestContext } from '../test/html-context.js';
import { Figure } from './figure.js';

const ctx = createTestContext();

describe('Figure', () => {
  it('renders an image when src is given', () => {
    const html = Figure({ src: 'cat.png', alt: 'A cat' }, 'caption', ctx);
    expect(html).toContain(
      '<img class="mk-figure__img" src="cat.png" alt="A cat">',
    );
    expect(html).toContain(
      '<figcaption class="mk-figure__caption">caption</figcaption>',
    );
  });

  it('omits the image entirely when src is absent', () => {
    const html = Figure({}, 'caption', ctx);
    expect(html).not.toContain('<img');
    expect(html).toContain('caption');
  });

  it('drops the image for an unsafe src scheme (e.g. javascript:) rather than throwing', () => {
    expect(() =>
      Figure({ src: 'javascript:alert(1)' }, 'caption', ctx),
    ).not.toThrow();
    const html = Figure({ src: 'javascript:alert(1)' }, 'caption', ctx);
    expect(html).not.toContain('<img');
  });

  it('defaults alt to the empty string', () => {
    const html = Figure({ src: 'cat.png' }, 'caption', ctx);
    expect(html).toContain('alt=""');
  });

  it('escapes src and alt', () => {
    const html = Figure(
      { src: 'cat.png?x="&y', alt: '<b>"cute"</b>' },
      'caption',
      ctx,
    );
    expect(html).not.toContain('"&y"');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;b&gt;');
  });
});

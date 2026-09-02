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

  it('resolves a relative src through ctx.resolveImageSrc, the same way an ordinary markdown image does', () => {
    const resolvedCtx = createTestContext({
      resolveImageSrc: (src) =>
        src === 'cat.png' ? 'https://cdn.test/cat.png' : undefined,
    });
    const html = Figure({ src: 'cat.png' }, 'caption', resolvedCtx);
    expect(html).toContain('src="https://cdn.test/cat.png"');
  });

  it('never offers an already-absolute src to the resolver', () => {
    const resolvedCtx = createTestContext({
      resolveImageSrc: () => {
        throw new Error('should never be asked for an absolute src');
      },
    });
    const html = Figure(
      { src: 'https://example.com/cat.png' },
      'caption',
      resolvedCtx,
    );
    expect(html).toContain('src="https://example.com/cat.png"');
  });

  it('rejects a resolver result that is not a safe URL, keeping the original src', () => {
    const resolvedCtx = createTestContext({
      resolveImageSrc: () => 'javascript:alert(1)',
    });
    const html = Figure({ src: 'cat.png' }, 'caption', resolvedCtx);
    expect(html).toContain('src="cat.png"');
    expect(html).not.toContain('javascript:');
  });
});

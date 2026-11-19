import { describe, expect, it } from 'vitest';
import type { DiagnosticEvent } from '@markii/stdlib';
import { createTestContext } from '../test/html-context.js';
import { Video } from './video.js';

const ctx = createTestContext();

describe('Video', () => {
  it('renders the fixed markup for a clip with poster, alt and caption', () => {
    const html = Video(
      { src: 'a.mp4', poster: 'a.png', alt: 'The demo' },
      '<p>caption</p>',
      ctx,
    );
    expect(html).toBe(
      '<figure class="mk-video"><span class="mk-video__frame">' +
        '<video class="mk-video__media" src="a.mp4" poster="a.png" aria-label="The demo" controls muted loop playsinline preload="metadata"></video>' +
        '</span><figcaption class="mk-video__caption"><p>caption</p></figcaption></figure>',
    );
    expect(html).not.toContain('autoplay');
  });

  it('omits poster and aria-label when absent or empty', () => {
    const html = Video({ src: 'a.mp4', poster: '', alt: '' }, '', ctx);
    expect(html).not.toContain('poster');
    expect(html).not.toContain('aria-label');
  });

  it('escapes src, poster and alt', () => {
    const html = Video(
      { src: 'a.mp4?x="&y', poster: 'p.png?"<', alt: '<b>"x"</b>' },
      '',
      ctx,
    );
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('"&y');
  });

  it('resolves src and poster through ctx.resolveImageSrc, using only the object form src', () => {
    const resolved = createTestContext({
      resolveImageSrc: (src) =>
        src === 'a.mp4'
          ? { src: 'app://vault/a.mp4', width: 10 }
          : 'app://vault/a.png',
    });
    const html = Video({ src: 'a.mp4', poster: 'a.png' }, '', resolved);
    expect(html).toContain('src="app://vault/a.mp4"');
    expect(html).toContain('poster="app://vault/a.png"');
    expect(html).not.toContain('width');
  });

  const refused = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:video/mp4;base64,AAAA',
    'DATA:video/mp4;base64,AAAA',
    ' \n data:video/mp4;base64,AAAA',
    'da\tta:video/mp4;base64,AAAA',
    'data:text/html,<script>alert(1)</script>',
  ];

  for (const src of refused) {
    it(`draws no <video> and reports for ${JSON.stringify(src)}`, () => {
      const events: DiagnosticEvent[] = [];
      const html = Video(
        { src },
        'caption',
        createTestContext({ onDiagnostic: (e) => events.push(e) }),
      );
      expect(html).not.toContain('<video');
      expect(html.toLowerCase()).not.toContain('javascript:');
      expect(html).toContain(
        'data-mk-notice="" title="video: source uses a scheme that is not allowed"',
      );
      expect(html).toContain('caption');
      expect(events).toEqual([
        {
          kind: 'unsafe-url',
          directive: 'video',
          message: 'video: source uses a scheme that is not allowed',
        },
      ]);
    });
  }

  it('refuses a data: URL a resolver returns for a clip', () => {
    const resolved = createTestContext({
      resolveImageSrc: () => 'data:image/png;base64,AAAA',
    });
    const html = Video({ src: 'a.mp4' }, 'caption', resolved);
    expect(html).not.toContain('<video');
    expect(html).toContain('data-mk-notice');
  });

  it('keeps the clip and drops a refused poster, with a marker and a diagnostic', () => {
    const events: DiagnosticEvent[] = [];
    const html = Video(
      { src: 'a.mp4', poster: 'javascript:alert(1)' },
      'caption',
      createTestContext({ onDiagnostic: (e) => events.push(e) }),
    );
    expect(html).toContain('src="a.mp4"');
    expect(html).not.toContain('poster=');
    expect(html).toContain(
      'title="video: poster uses a scheme that is not allowed, so no poster is shown"',
    );
    expect(events.map((e) => e.message)).toEqual([
      'video: poster uses a scheme that is not allowed, so no poster is shown',
    ]);
  });

  it('shows the caption and a marker when src is missing', () => {
    const events: DiagnosticEvent[] = [];
    const html = Video(
      {},
      'caption only',
      createTestContext({ onDiagnostic: (e) => events.push(e) }),
    );
    expect(html).not.toContain('<video');
    expect(html).toContain('caption only');
    expect(html).toContain(
      'title="video: no source was given, so no clip is shown"',
    );
    expect(events).toEqual([
      {
        kind: 'invalid-attribute-value',
        directive: 'video',
        attribute: 'src',
        message: 'video: no source was given, so no clip is shown',
      },
    ]);
  });
});

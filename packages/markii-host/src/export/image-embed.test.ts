import { describe, expect, it, vi } from 'vitest';
import {
  EMBEDDABLE_IMAGE_EXTENSIONS,
  MAX_EMBEDDED_IMAGE_BYTES,
  embedImagesInHtml,
  encodeBase64,
  isEmbeddableImageSrc,
  mimeTypeForImageSrc,
  toImageDataUri,
} from './image-embed.js';
import type { ExportImageReader } from './image-embed.js';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** A reader that serves `files` and reports everything else unreadable. */
function readerFor(files: Record<string, Uint8Array>): ExportImageReader {
  return (src) => {
    const bytes = files[src];
    return bytes
      ? { kind: 'bytes' as const, bytes }
      : { kind: 'unreadable' as const, detail: 'no such file' };
  };
}

describe('encodeBase64', () => {
  it('matches Buffer for every remainder length', () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        bytes[index] = (index * 37 + 11) % 256;
      }
      expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('encodes an empty array as an empty string', () => {
    expect(encodeBase64(new Uint8Array())).toBe('');
  });
});

describe('mimeTypeForImageSrc', () => {
  it('reads the extension, case-insensitively', () => {
    expect(mimeTypeForImageSrc('a/b/nice.PNG')).toBe('image/png');
    expect(mimeTypeForImageSrc('nice.jpeg')).toBe('image/jpeg');
    expect(mimeTypeForImageSrc('nice.svg')).toBe('image/svg+xml');
  });

  it('ignores a query or fragment', () => {
    expect(mimeTypeForImageSrc('nice.png?v=2')).toBe('image/png');
    expect(mimeTypeForImageSrc('nice.png#top')).toBe('image/png');
  });

  it('does not guess at an unknown or missing extension', () => {
    expect(mimeTypeForImageSrc('nice.tiff')).toBeUndefined();
    expect(mimeTypeForImageSrc('nice')).toBeUndefined();
    expect(mimeTypeForImageSrc('nice.')).toBeUndefined();
  });

  it('never resolves an inherited property as a type', () => {
    expect(mimeTypeForImageSrc('nice.constructor')).toBeUndefined();
    expect(mimeTypeForImageSrc('nice.toString')).toBeUndefined();
  });

  it('covers every advertised extension', () => {
    for (const extension of EMBEDDABLE_IMAGE_EXTENSIONS) {
      expect(mimeTypeForImageSrc(`x.${extension}`)).toBeTruthy();
    }
  });
});

describe('isEmbeddableImageSrc', () => {
  it('accepts a relative local path', () => {
    expect(isEmbeddableImageSrc('nice.png')).toBe(true);
    expect(isEmbeddableImageSrc('./assets/nice.png')).toBe(true);
    expect(isEmbeddableImageSrc('../assets/nice.png')).toBe(true);
    expect(isEmbeddableImageSrc('/assets/nice.png')).toBe(true);
  });

  it('leaves anything with a scheme alone', () => {
    expect(isEmbeddableImageSrc('https://x/y.png')).toBe(false);
    expect(isEmbeddableImageSrc('http://x/y.png')).toBe(false);
    expect(isEmbeddableImageSrc('data:image/png;base64,AAA')).toBe(false);
    expect(isEmbeddableImageSrc('//cdn/y.png')).toBe(false);
  });

  it('treats a later colon as part of a relative path', () => {
    expect(isEmbeddableImageSrc('notes/a:b.png')).toBe(true);
  });

  it('rejects an empty or fragment-only source', () => {
    expect(isEmbeddableImageSrc('')).toBe(false);
    expect(isEmbeddableImageSrc('#top')).toBe(false);
  });
});

describe('embedImagesInHtml', () => {
  it('replaces a local source with a data URI', async () => {
    const { html, report } = await embedImagesInHtml(
      '<p><img src="nice.png" alt="a"></p>',
      readerFor({ 'nice.png': PNG }),
    );
    expect(html).toBe(
      `<p><img src="${toImageDataUri(PNG, 'image/png')}" alt="a"></p>`,
    );
    expect(report.embedded).toEqual(['nice.png']);
    expect(report.embeddedBytes).toBe(PNG.byteLength);
    expect(report.skipped).toEqual([]);
  });

  it('leaves remote and already-embedded sources exactly as authored', async () => {
    const html =
      '<img src="https://x/y.png"><img src="data:image/png;base64,AA">';
    const result = await embedImagesInHtml(html, readerFor({}));
    expect(result.html).toBe(html);
    expect(result.report.remote).toBe(2);
    expect(result.report.skipped).toEqual([]);
  });

  it('reads each distinct source once, however often it appears', async () => {
    const read = vi.fn(readerFor({ 'nice.png': PNG }));
    const { html } = await embedImagesInHtml(
      '<img src="nice.png"><img src="nice.png"><img src="nice.png">',
      read,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(html.split('data:image/png').length - 1).toBe(3);
  });

  it('keeps the path and reports the size for an image over the cap', async () => {
    const huge = new Uint8Array(MAX_EMBEDDED_IMAGE_BYTES + 1);
    const { html, report } = await embedImagesInHtml(
      '<img src="huge.png">',
      readerFor({ 'huge.png': huge }),
    );
    expect(html).toBe('<img src="huge.png">');
    expect(report.skipped).toEqual([
      { src: 'huge.png', reason: 'too-large', byteLength: huge.byteLength },
    ]);
  });

  it('accepts a host that measured the file itself and refused to read it', async () => {
    const { html, report } = await embedImagesInHtml(
      '<img src="huge.png">',
      () => ({ kind: 'oversize', byteLength: 9_000_000 }),
    );
    expect(html).toBe('<img src="huge.png">');
    expect(report.skipped[0]).toEqual({
      src: 'huge.png',
      reason: 'too-large',
      byteLength: 9_000_000,
    });
  });

  it('keeps the path and reports why for a missing image', async () => {
    const { html, report } = await embedImagesInHtml(
      '<img src="gone.png">',
      readerFor({}),
    );
    expect(html).toBe('<img src="gone.png">');
    expect(report.skipped).toEqual([
      { src: 'gone.png', reason: 'unreadable', detail: 'no such file' },
    ]);
  });

  it('treats a reader that throws as unreadable rather than losing the export', async () => {
    const { html, report } = await embedImagesInHtml(
      '<img src="bad.png">',
      () => {
        throw new Error('EACCES');
      },
    );
    expect(html).toBe('<img src="bad.png">');
    expect(report.skipped[0]).toEqual({
      src: 'bad.png',
      reason: 'unreadable',
      detail: 'EACCES',
    });
  });

  it('does not embed an unrecognized extension, and says so', async () => {
    const { html, report } = await embedImagesInHtml(
      '<img src="chart.tiff">',
      readerFor({ 'chart.tiff': PNG }),
    );
    expect(html).toBe('<img src="chart.tiff">');
    expect(report.skipped).toEqual([
      { src: 'chart.tiff', reason: 'unsupported-type' },
    ]);
  });

  it('resolves an escaped source the way the author wrote it', async () => {
    const { html, report } = await embedImagesInHtml(
      '<img src="a&amp;b.png">',
      readerFor({ 'a&b.png': PNG }),
    );
    expect(report.embedded).toEqual(['a&b.png']);
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('a&amp;b.png');
  });

  it('leaves an img that has no src attribute alone', async () => {
    const html = '<img alt="none">';
    expect((await embedImagesInHtml(html, readerFor({}))).html).toBe(html);
  });

  it('never matches an escaped img a note merely talks about', async () => {
    const html = '<pre><code>&lt;img src="nice.png"&gt;</code></pre>';
    const result = await embedImagesInHtml(
      html,
      readerFor({ 'nice.png': PNG }),
    );
    expect(result.html).toBe(html);
    expect(result.report.embedded).toEqual([]);
  });

  it('embeds several different images in one pass', async () => {
    const other = new Uint8Array([1, 2, 3]);
    const { report } = await embedImagesInHtml(
      '<img src="a.png"><img src="b.gif"><img src="https://x/c.png">',
      readerFor({ 'a.png': PNG, 'b.gif': other }),
    );
    expect(report.embedded).toEqual(['a.png', 'b.gif']);
    expect(report.embeddedBytes).toBe(PNG.byteLength + other.byteLength);
    expect(report.remote).toBe(1);
  });
});

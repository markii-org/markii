import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { openPackArchive, packArchiveFileName } from './archive.js';

const enc = new TextEncoder();

const VALID_MANIFEST = JSON.stringify({
  name: 'ana',
  engine: 'react',
  components: { timeline: './Timeline.tsx' },
  version: '1.0.0',
});

/** Builds real zip bytes via fflate's own writer, so every probe exercises real archive bytes rather than a mock reader. */
function buildZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6 });
}

function wellFormedFiles(
  overrides: Record<string, Uint8Array | undefined> = {},
): Record<string, Uint8Array> {
  const base: Record<string, Uint8Array | undefined> = {
    'pack.json': enc.encode(VALID_MANIFEST),
    'webview.js': enc.encode('/* compiled pack script */'),
    'webview.css': enc.encode('.mk-ana_timeline { color: var(--mk-fg); }'),
    'scripts/http.lua': enc.encode('return {}'),
    ...overrides,
  };
  const result: Record<string, Uint8Array> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

describe('openPackArchive: happy path', () => {
  it('reads manifest, webview.js, webview.css, and scripts/ from a well-formed .mkp', async () => {
    const bytes = buildZip(wellFormedFiles());
    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.archive.manifest).toEqual({
      name: 'ana',
      engine: 'react',
      components: { timeline: './Timeline.tsx' },
      version: '1.0.0',
    });
    expect(result.archive.manifestWarnings).toEqual([]);
    expect(new TextDecoder().decode(result.archive.scriptBytes)).toBe(
      '/* compiled pack script */',
    );
    expect(result.archive.stylesheetBytes).toBeDefined();
    expect(
      new TextDecoder().decode(
        result.archive.stylesheetBytes ?? new Uint8Array(),
      ),
    ).toBe('.mk-ana_timeline { color: var(--mk-fg); }');
    expect(Object.keys(result.archive.scriptModules)).toEqual(['http.lua']);
    expect(
      new TextDecoder().decode(result.archive.scriptModules['http.lua']),
    ).toBe('return {}');
    expect(result.archive.ignoredEntries).toEqual([]);
  });

  it('accepts a .mkp with no webview.css and no scripts/', async () => {
    const bytes = buildZip(
      wellFormedFiles({
        'webview.css': undefined,
        'scripts/http.lua': undefined,
      }),
    );
    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archive.stylesheetBytes).toBeUndefined();
    expect(result.archive.scriptModules).toEqual({});
  });

  it('accepts a manifest with no version and reads it through', async () => {
    const manifest = JSON.stringify({
      name: 'ana',
      engine: 'react',
      components: {},
    });
    const bytes = buildZip(
      wellFormedFiles({
        'pack.json': enc.encode(manifest),
        'scripts/http.lua': undefined,
      }),
    );
    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archive.manifest.version).toBeUndefined();
  });

  it('reports a leftover source file as ignored rather than rejecting the archive', async () => {
    const bytes = buildZip(
      wellFormedFiles({
        'Timeline.tsx': enc.encode('export const Timeline = () => null;'),
      }),
    );
    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archive.ignoredEntries).toEqual(['Timeline.tsx']);
  });
});

describe('openPackArchive: required entries', () => {
  it('rejects an archive with no pack.json', async () => {
    const bytes = buildZip(wellFormedFiles({ 'pack.json': undefined }));
    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('missing-entry');
    if (result.error.kind === 'missing-entry') {
      expect(result.error.entry).toBe('pack.json');
    }
  });

  it('rejects an archive with no webview.js (source-only is not a valid .mkp)', async () => {
    const bytes = buildZip(wellFormedFiles({ 'webview.js': undefined }));
    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('missing-entry');
    if (result.error.kind === 'missing-entry') {
      expect(result.error.entry).toBe('webview.js');
    }
  });

  it('rejects a pack.json nested under a folder instead of the archive root', async () => {
    const bytes = buildZip(
      wellFormedFiles({
        'pack.json': undefined,
        'ana/pack.json': enc.encode(VALID_MANIFEST),
      }),
    );
    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('missing-entry');
  });

  it('rejects an archive whose pack.json fails manifest validation', async () => {
    const bytes = buildZip(
      wellFormedFiles({
        'pack.json': enc.encode(JSON.stringify({ name: 'ana' })),
      }),
    );
    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('manifest');
  });

  it('never throws even on a completely invalid zip', async () => {
    const bytes = enc.encode('this is not a zip file at all');
    await expect(openPackArchive(bytes)).resolves.toMatchObject({ ok: false });
  });
});

describe('openPackArchive: security probes (real hostile bytes, real reader)', () => {
  it('rejects an entry whose path escapes the archive root via "../"', async () => {
    const bytes = buildZip(
      wellFormedFiles({
        'webview.js': undefined,
        '../evil.js': enc.encode('x'.repeat(10)),
      }),
    );

    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('zip');
    if (result.error.kind === 'zip') {
      expect(result.error.message).toMatch(/unsafe path/);
      expect(result.error.message).toContain('../evil.js');
    }
  });

  it('rejects an entry with an absolute path', async () => {
    const bytes = buildZip(
      wellFormedFiles({
        'webview.js': undefined,
        '/etc/passwd': enc.encode('x'.repeat(10)),
      }),
    );

    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('zip');
    if (result.error.kind === 'zip') {
      expect(result.error.message).toMatch(/unsafe path/);
      expect(result.error.message).toContain('/etc/passwd');
    }
  });

  it('rejects a deep-traversal path that would land outside the pack directory', async () => {
    const bytes = buildZip(
      wellFormedFiles({
        'webview.js': undefined,
        '../../../../home/escaped.js': enc.encode('x'),
      }),
    );

    const result = await openPackArchive(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('zip');
  });

  it('rejects an oversized entry before it is materialized', async () => {
    // A real, honestly-declared 10 KiB entry, opened against a reader
    // configured with an 8-byte per-entry cap. openZipBundle checks the
    // central directory's declared uncompressed size against the cap
    // BEFORE calling inflateSync — so this rejects without ever allocating
    // a decompression buffer for the oversized payload.
    const bytes = buildZip(
      wellFormedFiles({ 'webview.js': enc.encode('x'.repeat(10 * 1024)) }),
    );

    const result = await openPackArchive(bytes, { maxEntryBytes: 8 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('zip');
    if (result.error.kind === 'zip') {
      expect(result.error.message).toMatch(
        /exceeding the 8-byte per-entry limit/,
      );
    }
  });

  it('rejects once the summed declared size of all entries crosses the total budget', async () => {
    const bytes = buildZip(wellFormedFiles());

    const result = await openPackArchive(bytes, { maxTotalBytes: 4 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('zip');
    if (result.error.kind === 'zip') {
      expect(result.error.message).toMatch(
        /total declared uncompressed size exceeds/,
      );
    }
  });

  it('every rejection above reports a structured error rather than throwing, and never yields archive contents', async () => {
    const hostileArchives = [
      buildZip(
        wellFormedFiles({
          'webview.js': undefined,
          '../evil.js': enc.encode('x'),
        }),
      ),
      buildZip(
        wellFormedFiles({
          'webview.js': undefined,
          '/etc/passwd': enc.encode('x'),
        }),
      ),
      buildZip(wellFormedFiles({ 'webview.js': enc.encode('x'.repeat(1024)) })),
    ];

    for (const bytes of hostileArchives) {
      let result: Awaited<ReturnType<typeof openPackArchive>> | undefined;
      await expect(
        (async () => {
          result = await openPackArchive(bytes, { maxEntryBytes: 8 });
        })(),
      ).resolves.toBeUndefined();
      expect(result?.ok).toBe(false);
      // No filesystem write ever happens inside this module (it takes
      // bytes and returns parsed data or an error), so "nothing is written
      // outside the pack directory" holds by construction on every one of
      // these paths — there is no write path to have escaped from.
    }
  });
});

describe('packArchiveFileName', () => {
  it('names a produced archive "<name>-<version>.mkp" when a version is declared', () => {
    expect(packArchiveFileName({ name: 'ana', version: '1.0.0' })).toBe(
      'ana-1.0.0.mkp',
    );
  });

  it('falls back to "<name>.mkp" when version is absent, rather than inventing a placeholder version', () => {
    expect(packArchiveFileName({ name: 'ana', version: undefined })).toBe(
      'ana.mkp',
    );
  });
});

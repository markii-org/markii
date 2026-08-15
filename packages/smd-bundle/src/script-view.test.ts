import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ScriptCapabilityError } from './errors';
import type { BundleManifest } from './manifest';
import { createScriptView } from './script-view';
import { openZipBundle } from './zip';

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function fixtureStorage() {
  const bytes = zipSync({
    'note.smd': u8('# hello'),
    'manifest.json': u8('{"smd":"0.1.0"}'),
    'assets/x.png': u8('img'),
    'cache/data.json': u8('{}'),
  });
  return openZipBundle(bytes);
}

function manifestWith(
  permissions: BundleManifest['permissions'],
): BundleManifest {
  return { smd: '0.1.0', permissions };
}

describe('createScriptView — no grants', () => {
  it('denies reads with no permissions declared at all', async () => {
    const view = createScriptView(fixtureStorage(), manifestWith(undefined));
    await expect(view.read('assets/x.png')).rejects.toThrow(
      ScriptCapabilityError,
    );
  });

  it('denies exists with no permissions declared', async () => {
    const view = createScriptView(fixtureStorage(), manifestWith(undefined));
    await expect(view.exists('assets/x.png')).rejects.toThrow(
      ScriptCapabilityError,
    );
  });

  it('denies writes with no permissions declared', async () => {
    const view = createScriptView(fixtureStorage(), manifestWith(undefined));
    await expect(view.write('cache/out.json', u8('{}'))).rejects.toThrow(
      ScriptCapabilityError,
    );
  });

  it('denies reads when bundle grants array is empty', async () => {
    const view = createScriptView(
      fixtureStorage(),
      manifestWith({ bundle: [] }),
    );
    await expect(view.read('assets/x.png')).rejects.toThrow(
      ScriptCapabilityError,
    );
  });
});

describe('createScriptView — read grant', () => {
  it('allows reads bundle-wide', async () => {
    const view = createScriptView(
      fixtureStorage(),
      manifestWith({ bundle: ['read'] }),
    );
    expect(await view.read('assets/x.png')).toEqual(u8('img'));
    expect(await view.read('note.smd')).toEqual(u8('# hello'));
    expect(await view.read('manifest.json')).toEqual(u8('{"smd":"0.1.0"}'));
  });

  it('allows exists bundle-wide', async () => {
    const view = createScriptView(
      fixtureStorage(),
      manifestWith({ bundle: ['read'] }),
    );
    expect(await view.exists('note.smd')).toBe(true);
    expect(await view.exists('nope.txt')).toBe(false);
  });

  it('still denies writes with only the read grant', async () => {
    const view = createScriptView(
      fixtureStorage(),
      manifestWith({ bundle: ['read'] }),
    );
    await expect(view.write('cache/out.json', u8('{}'))).rejects.toThrow(
      ScriptCapabilityError,
    );
  });
});

describe('createScriptView — write:cache/ grant', () => {
  it('allows a cache/ write', async () => {
    const storage = fixtureStorage();
    const view = createScriptView(
      storage,
      manifestWith({ bundle: ['write:cache/'] }),
    );
    await view.write('cache/out.json', u8('{"ok":true}'));
    expect(await storage.read('cache/out.json')).toEqual(u8('{"ok":true}'));
  });

  it('denies writing manifest.json even with write:cache/ granted', async () => {
    const view = createScriptView(
      fixtureStorage(),
      manifestWith({ bundle: ['write:cache/'] }),
    );
    await expect(
      view.write('manifest.json', u8('{"smd":"9.9.9"}')),
    ).rejects.toThrow(ScriptCapabilityError);
  });

  it('denies writing note.smd even with write:cache/ granted', async () => {
    const view = createScriptView(
      fixtureStorage(),
      manifestWith({ bundle: ['write:cache/'] }),
    );
    await expect(view.write('note.smd', u8('# hacked'))).rejects.toThrow(
      ScriptCapabilityError,
    );
  });

  it('denies writing assets/x (outside cache/) even with write:cache/ granted', async () => {
    const view = createScriptView(
      fixtureStorage(),
      manifestWith({ bundle: ['write:cache/'] }),
    );
    await expect(view.write('assets/x.png', u8('overwritten'))).rejects.toThrow(
      ScriptCapabilityError,
    );
  });

  it('a manifest maliciously listing write:cache/ still cannot write manifest.json', async () => {
    // Simulates a hostile/tampered manifest object claiming a grant that
    // would let it rewrite its own permissions — isWriteAllowed's
    // unconditional manifest.json denial must hold regardless.
    const storage = fixtureStorage();
    const hostileManifest: BundleManifest = {
      smd: '0.1.0',
      permissions: { bundle: ['read', 'write:cache/'] },
    };
    const view = createScriptView(storage, hostileManifest);
    await expect(
      view.write(
        'manifest.json',
        u8(
          '{"smd":"0.1.0","permissions":{"bundle":["read","write:cache/"],"net":{"get":["evil.example"]}}}',
        ),
      ),
    ).rejects.toThrow(ScriptCapabilityError);
    // The stored manifest.json must be untouched.
    expect(await storage.read('manifest.json')).toEqual(u8('{"smd":"0.1.0"}'));
  });
});

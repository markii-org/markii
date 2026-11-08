/**
 * `markii pack install/list/remove` and pack loading in `view` and
 * `export --format ansi`, end to end through the real `run` over a fake
 * terminal and a per-test config directory. The packs here are hand-written
 * `terminal.js` modules built only from docs/packs.md's registration
 * contract, zipped into real `.mkp` archives.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { run } from './main.js';
import { packStoreDirectory } from './pack-store.js';
import { createFakeTerminal } from './test-terminal.js';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  delete (globalThis as Record<string, unknown>)['__markiiTestPackRan'];
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'markii-cli-packs-'));
  tempDirs.push(dir);
  return dir;
}

/** Points the config directory (every platform's variant) at a fresh temp folder. */
function configEnv(): { env: Record<string, string>; packRoot: string } {
  const home = makeTempDir();
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    XDG_CONFIG_HOME: home,
  };
  return { env, packRoot: packStoreDirectory(env, process.platform) };
}

const enc = new TextEncoder();

function manifestFor(name: string, sources: Record<string, string>): string {
  return JSON.stringify({
    name,
    engine: 'react',
    version: '1.0.0',
    components: { timeline: { sources } },
  });
}

const TERMINAL_JS = (manifest: string): string =>
  `globalThis.__markiiRegisterTerminalPack(${JSON.stringify(manifest)}, {
    timeline: { component: ({ attributes }) => 'TL:' + attributes.title },
  });\n`;

function archive(
  name: string,
  terminalJs: string | undefined,
  sources: Record<string, string>,
): Uint8Array {
  const manifest = manifestFor(name, sources);
  const files: Record<string, Uint8Array> = {
    'pack.json': enc.encode(manifest),
    'webview.js': enc.encode('/* react views */'),
  };
  if (terminalJs !== undefined) files['terminal.js'] = enc.encode(terminalJs);
  return zipSync(files);
}

function writeArchive(dir: string, file: string, bytes: Uint8Array): string {
  const full = path.join(dir, file);
  writeFileSync(full, bytes);
  return full;
}

const BOTH = { react: './T.tsx', ansi: './T.ansi.tsx' };

function note(dir: string, text: string): string {
  const full = path.join(dir, 'note.mk.md');
  writeFileSync(full, text, 'utf8');
  return full;
}

const NOTE = '::ana_timeline{title="hello"}\ncontent\n::\n';

describe('markii pack install', () => {
  it('refuses without a terminal and without --yes, and writes nothing', async () => {
    const { env, packRoot } = configEnv();
    const dir = makeTempDir();
    const mkp = writeArchive(
      dir,
      'ana.mkp',
      archive('ana', TERMINAL_JS(manifestFor('ana', BOTH)), BOTH),
    );
    const terminal = createFakeTerminal({ env, stdinIsTty: false });

    expect(await run(['pack', 'install', mkp], terminal)).toBe(1);
    expect(existsSync(path.join(packRoot, 'ana'))).toBe(false);
    expect(terminal.errLines.join('')).toContain('--yes');
  });

  it('installs with --yes, lists the pack, and renders its terminal view in view', async () => {
    const { env, packRoot } = configEnv();
    const dir = makeTempDir();
    const mkp = writeArchive(
      dir,
      'ana.mkp',
      archive('ana', TERMINAL_JS(manifestFor('ana', BOTH)), BOTH),
    );

    const install = createFakeTerminal({ env });
    expect(await run(['pack', 'install', mkp, '--yes'], install)).toBe(0);
    expect(install.outLines.join('')).toContain('installed pack "ana"');
    expect(
      readFileSync(path.join(packRoot, 'ana', 'terminal.js'), 'utf8'),
    ).toContain('TL:');

    const list = createFakeTerminal({ env });
    expect(await run(['pack', 'list'], list)).toBe(0);
    expect(list.outLines.join('')).toContain(
      'ana 1.0.0: 1 terminal component (installed)',
    );

    const file = note(dir, NOTE);
    const view = createFakeTerminal({ env });
    expect(
      await run(['view', file, '--static', '--color', 'never'], view),
    ).toBe(0);
    expect(view.outLines.join('')).toContain('TL:hello');
    expect(view.errLines).toEqual([]);

    const out = path.join(dir, 'out.txt');
    const exported = createFakeTerminal({ env });
    expect(
      await run(['export', file, '--format', 'ansi', '-o', out], exported),
    ).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('TL:hello');
  });

  it('asks in a terminal, and a no answer installs nothing', async () => {
    const { env, packRoot } = configEnv();
    const dir = makeTempDir();
    const mkp = writeArchive(
      dir,
      'ana.mkp',
      archive('ana', TERMINAL_JS(manifestFor('ana', BOTH)), BOTH),
    );
    const terminal = createFakeTerminal({
      env,
      stdinIsTty: true,
      askAnswers: ['n'],
    });

    expect(await run(['pack', 'install', mkp], terminal)).toBe(1);
    expect(terminal.askedQuestions).toHaveLength(1);
    expect(terminal.askedQuestions[0]).toContain(
      'all the permissions of your user account',
    );
    expect(existsSync(path.join(packRoot, 'ana'))).toBe(false);
  });

  it('refuses a built-in namespace', async () => {
    const { env, packRoot } = configEnv();
    const dir = makeTempDir();
    const mkp = writeArchive(
      dir,
      'read.mkp',
      archive('read', TERMINAL_JS(manifestFor('read', BOTH)), BOTH),
    );
    const terminal = createFakeTerminal({ env });

    expect(await run(['pack', 'install', mkp, '--yes'], terminal)).toBe(1);
    expect(terminal.errLines.join('')).toContain('built in');
    expect(existsSync(path.join(packRoot, 'read'))).toBe(false);
  });

  it('installs a React-only pack and says it has no terminal views', async () => {
    const { env } = configEnv();
    const dir = makeTempDir();
    const reactOnly = { react: './T.tsx' };
    const mkp = writeArchive(
      dir,
      'ana.mkp',
      archive('ana', undefined, reactOnly),
    );
    const terminal = createFakeTerminal({ env });

    expect(await run(['pack', 'install', mkp, '--yes'], terminal)).toBe(0);
    expect(terminal.outLines.join('')).toContain('has no terminal views');

    const list = createFakeTerminal({ env });
    await run(['pack', 'list'], list);
    expect(list.outLines.join('')).toContain('ana: no terminal views');

    const view = createFakeTerminal({ env });
    const file = note(dir, NOTE);
    expect(
      await run(['view', file, '--static', '--color', 'never'], view),
    ).toBe(0);
    expect(view.outLines.join('')).toContain('unknown component');
    expect(view.errLines).toEqual([]);
  });

  it('rejects a file that is not a pack archive', async () => {
    const { env } = configEnv();
    const dir = makeTempDir();
    const bogus = path.join(dir, 'bogus.mkp');
    writeFileSync(bogus, 'not a zip');
    const terminal = createFakeTerminal({ env });

    expect(await run(['pack', 'install', bogus, '--yes'], terminal)).toBe(1);
    expect(terminal.errLines.join('')).toContain('could not install a pack');
  });
});

describe('markii pack remove', () => {
  it('removes an installed pack, then reports it as not installed', async () => {
    const { env, packRoot } = configEnv();
    const dir = makeTempDir();
    const mkp = writeArchive(
      dir,
      'ana.mkp',
      archive('ana', TERMINAL_JS(manifestFor('ana', BOTH)), BOTH),
    );
    await run(['pack', 'install', mkp, '--yes'], createFakeTerminal({ env }));

    const first = createFakeTerminal({ env });
    expect(await run(['pack', 'remove', 'ana'], first)).toBe(0);
    expect(existsSync(path.join(packRoot, 'ana'))).toBe(false);

    const second = createFakeTerminal({ env });
    expect(await run(['pack', 'remove', 'ana'], second)).toBe(1);
    expect(second.errLines.join('')).toContain('no pack named "ana"');
  });

  it('refuses a namespace that could escape the store', async () => {
    const { env } = configEnv();
    const terminal = createFakeTerminal({ env });
    expect(await run(['pack', 'remove', '../x'], terminal)).toBe(1);
  });
});

describe('a broken or untrusted pack', () => {
  it('a terminal.js that throws leaves the fallback in the note and a reason on stderr', async () => {
    const { env, packRoot } = configEnv();
    const dir = makeTempDir();
    const folder = path.join(packRoot, 'ana');
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'pack.json'), manifestFor('ana', BOTH));
    writeFileSync(
      path.join(folder, 'terminal.js'),
      'throw new Error("boom");\n',
    );

    const view = createFakeTerminal({ env });
    const file = note(dir, NOTE);
    expect(
      await run(['view', file, '--static', '--color', 'never'], view),
    ).toBe(0);
    expect(view.outLines.join('')).toContain('unknown component');
    expect(view.errLines.join('')).toContain('Pack "ana" was not loaded');
    expect(view.errLines.join('')).toContain('boom');
  });

  it('a terminal.js that registers another namespace is refused', async () => {
    const { env, packRoot } = configEnv();
    const dir = makeTempDir();
    const folder = path.join(packRoot, 'ana');
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'pack.json'), manifestFor('ana', BOTH));
    writeFileSync(
      path.join(folder, 'terminal.js'),
      TERMINAL_JS(manifestFor('read', BOTH)),
    );

    const view = createFakeTerminal({ env });
    expect(
      await run(
        ['view', note(dir, NOTE), '--static', '--color', 'never'],
        view,
      ),
    ).toBe(0);
    expect(view.errLines.join('')).toContain('does not match its pack.json');
  });

  it('a pack folder beside the note, in the working directory, or named by an environment variable is never loaded', async () => {
    const { env } = configEnv();
    const dir = makeTempDir();
    const marker = '__markiiTestPackRan';
    const sneaky = `globalThis.${marker} = true;\n${TERMINAL_JS(manifestFor('ana', BOTH))}`;
    for (const where of ['packs/ana', 'ana', '.markii/packs/ana']) {
      const folder = path.join(dir, where);
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, 'pack.json'), manifestFor('ana', BOTH));
      writeFileSync(path.join(folder, 'terminal.js'), sneaky);
    }
    const hostile = { ...env, MARKII_PACKS: dir, MARKII_PACK_PATH: dir };

    const view = createFakeTerminal({ env: hostile });
    const file = note(dir, `---\nuses: [ana]\n---\n${NOTE}`);
    expect(
      await run(['view', file, '--static', '--color', 'never'], view),
    ).toBe(0);
    expect(view.outLines.join('')).toContain('unknown component');
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it('control characters in an attribute cannot reach the output through a pack', async () => {
    const { env } = configEnv();
    const dir = makeTempDir();
    const mkp = writeArchive(
      dir,
      'ana.mkp',
      archive('ana', TERMINAL_JS(manifestFor('ana', BOTH)), BOTH),
    );
    await run(['pack', 'install', mkp, '--yes'], createFakeTerminal({ env }));

    const file = note(
      dir,
      '::ana_timeline{title="a&#27;[31mred&#7;b"}\nx\n::\n',
    );
    const view = createFakeTerminal({ env });
    await run(['view', file, '--static', '--color', 'never'], view);
    expect(view.outLines.join('')).toContain('TL:a');
    expect(view.outLines.join('')).not.toMatch(
      /[\u0000-\u0008\u000b-\u001f\u007f]/,
    );
  });
});

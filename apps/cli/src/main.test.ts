import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { run } from './main.js';
import { createFakeTerminal } from './test-terminal.js';
import type { MountLiveViewerInput, ViewDeps } from './view-deps.js';

/**
 * `view`'s non-interactive skip path (AGENTS.md's "clean is not silent"):
 * when stdin/stdout is not a terminal, scripts never run even with `--run`
 * (the default), so a note carrying script blocks would otherwise render
 * from stale/cached values with no visible sign anything was skipped. This
 * covers `runViewCommand`'s `else` branch in `main.ts`, which is the ONLY
 * place that line is written.
 */
describe('view: scripts-not-run notice', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'markii-cli-main-'));
    tempDirs.push(dir);
    return dir;
  }

  function writeNote(dir: string, name: string, text: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, text, 'utf8');
    return file;
  }

  it('prints the notice to stderr when a note with scripts is viewed without a terminal', async () => {
    const dir = makeTempDir();
    const file = writeNote(
      dir,
      'note.mk.md',
      ['```lua {name=stars}', 'return 1', '```', '', ':value[stars]', ''].join(
        '\n',
      ),
    );
    const terminal = createFakeTerminal({
      stdinIsTty: false,
      stdoutIsTty: false,
      env: { XDG_CONFIG_HOME: dir },
    });

    const exitCode = await run(['view', file], terminal);

    expect(exitCode).toBe(0);
    expect(terminal.errLines.join('')).toContain(
      'markii: scripts not run because the output is not a terminal; use markii run first',
    );
  });

  it('stays silent when the note has no scripts', async () => {
    const dir = makeTempDir();
    const file = writeNote(dir, 'note.mk.md', '# Just markdown\n');
    const terminal = createFakeTerminal({
      stdinIsTty: false,
      stdoutIsTty: false,
      env: { XDG_CONFIG_HOME: dir },
    });

    const exitCode = await run(['view', file], terminal);

    expect(exitCode).toBe(0);
    expect(terminal.errLines.join('')).not.toContain('scripts not run');
  });

  it('stays silent when --no-run is given, even with scripts present', async () => {
    const dir = makeTempDir();
    const file = writeNote(
      dir,
      'note.mk.md',
      ['```lua {name=stars}', 'return 1', '```', ''].join('\n'),
    );
    const terminal = createFakeTerminal({
      stdinIsTty: false,
      stdoutIsTty: false,
      env: { XDG_CONFIG_HOME: dir },
    });

    const exitCode = await run(['view', file, '--no-run'], terminal);

    expect(exitCode).toBe(0);
    expect(terminal.errLines.join('')).not.toContain('scripts not run');
  });
});

/**
 * `markii view`'s mode selection (batch 10's live viewer): both streams
 * being TTYs mounts the live app, `--static` forces the render-once path
 * even then, and either stream not being a TTY keeps today's static
 * behavior. A fake `mountLiveViewer` stands in for the real Ink mount so
 * these tests never touch a real TTY (per AGENTS.md's testability rule and
 * the batch-10 brief's "do not spawn a real TTY" instruction).
 */
describe('view: live/static mode selection', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'markii-cli-main-mode-'));
    tempDirs.push(dir);
    return dir;
  }

  function writeNote(dir: string, name: string, text: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, text, 'utf8');
    return file;
  }

  function fakeViewDeps(): ViewDeps & { calls: MountLiveViewerInput[] } {
    const calls: MountLiveViewerInput[] = [];
    return {
      calls,
      mountLiveViewer: async (input) => {
        calls.push(input);
      },
    };
  }

  it('mounts the live viewer when both stdin and stdout are TTYs', async () => {
    const dir = makeTempDir();
    const file = writeNote(dir, 'note.mk.md', '# Just markdown\n');
    const terminal = createFakeTerminal({
      stdinIsTty: true,
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const view = fakeViewDeps();

    const exitCode = await run(['view', file], terminal, { view });

    expect(exitCode).toBe(0);
    expect(view.calls).toHaveLength(1);
    // The live path never writes the rendered document to stdout itself —
    // that is the mounted Ink app's job.
    expect(terminal.outLines.join('')).toBe('');
  });

  it('--static forces the render-once path even with both streams TTYs', async () => {
    const dir = makeTempDir();
    const file = writeNote(dir, 'note.mk.md', '# Just markdown\n');
    const terminal = createFakeTerminal({
      stdinIsTty: true,
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const view = fakeViewDeps();

    const exitCode = await run(['view', file, '--static'], terminal, {
      view,
    });

    expect(exitCode).toBe(0);
    expect(view.calls).toHaveLength(0);
    expect(terminal.outLines.join('')).toContain('Just markdown');
  });

  it('renders statically when stdout is not a TTY', async () => {
    const dir = makeTempDir();
    const file = writeNote(dir, 'note.mk.md', '# Just markdown\n');
    const terminal = createFakeTerminal({
      stdinIsTty: true,
      stdoutIsTty: false,
      env: { XDG_CONFIG_HOME: dir },
    });
    const view = fakeViewDeps();

    const exitCode = await run(['view', file], terminal, { view });

    expect(exitCode).toBe(0);
    expect(view.calls).toHaveLength(0);
    expect(terminal.outLines.join('')).toContain('Just markdown');
  });

  it('renders statically when stdin is not a TTY', async () => {
    const dir = makeTempDir();
    const file = writeNote(dir, 'note.mk.md', '# Just markdown\n');
    const terminal = createFakeTerminal({
      stdinIsTty: false,
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const view = fakeViewDeps();

    const exitCode = await run(['view', file], terminal, { view });

    expect(exitCode).toBe(0);
    expect(view.calls).toHaveLength(0);
    expect(terminal.outLines.join('')).toContain('Just markdown');
  });

  it('runs scripts first, then mounts the live viewer with the resulting values', async () => {
    const dir = makeTempDir();
    const file = writeNote(
      dir,
      'note.mk.md',
      ['```lua {name=stars}', 'return 42', '```', '', ':value[stars]', ''].join(
        '\n',
      ),
    );
    const terminal = createFakeTerminal({
      stdinIsTty: true,
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const view = fakeViewDeps();

    const exitCode = await run(['view', file], terminal, { view });

    expect(exitCode).toBe(0);
    expect(view.calls).toHaveLength(1);
    // The store handed to the live viewer already carries the script's
    // result: the run happened before the mount, not after.
    expect(view.calls[0]?.store.get('stars')?.value).toBe(42);
  });

  it('still exits 2 on a script failure even though the viewer ran', async () => {
    const dir = makeTempDir();
    const file = writeNote(
      dir,
      'note.mk.md',
      ['```lua {name=broken}', 'error("boom")', '```', ''].join('\n'),
    );
    const terminal = createFakeTerminal({
      stdinIsTty: true,
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const view = fakeViewDeps();

    const exitCode = await run(['view', file], terminal, { view });

    expect(exitCode).toBe(2);
    expect(view.calls).toHaveLength(1);
    // Diagnostics are held while the app is "mounted" (the fake resolves
    // immediately) and flushed only once mountLiveViewer returns.
    expect(terminal.errLines.join('')).toContain('script "broken" failed');
  });
});

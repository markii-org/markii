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

describe('view --watch', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeNote(text: string): { dir: string; file: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'markii-cli-main-watch-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'note.mk.md');
    writeFileSync(file, text, 'utf8');
    return { dir, file };
  }

  /** A watch the test fires by hand, and an interrupt it releases by hand. */
  function controlledDeps(mount?: ViewDeps['mountLiveViewer']) {
    const state: {
      watched: string[];
      fire: (() => void) | undefined;
      closed: boolean;
      interrupt: (() => void) | undefined;
    } = {
      watched: [],
      fire: undefined,
      closed: false,
      interrupt: undefined,
    };
    const deps: ViewDeps = {
      mountLiveViewer: mount ?? (async () => {}),
      watchNote: (absolutePath, onChange) => {
        state.watched.push(absolutePath);
        state.fire = onChange;
        return {
          close: () => {
            state.closed = true;
          },
        };
      },
      untilInterrupted: () =>
        new Promise<void>((resolve) => {
          state.interrupt = resolve;
        }),
    };
    return { deps, state };
  }

  /** Lets the read-and-render chain behind one change settle. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it('refuses a pipe with exit code 3 and one line of reason', async () => {
    const { dir, file } = makeNote('# Note\n');
    const terminal = createFakeTerminal({
      stdoutIsTty: false,
      env: { XDG_CONFIG_HOME: dir },
    });

    const exitCode = await run(['view', file, '--watch'], terminal);

    expect(exitCode).toBe(3);
    expect(terminal.outLines).toEqual([]);
    expect(terminal.errLines).toEqual([
      'markii: --watch needs a terminal on stdout, since it redraws the screen on every change\n',
    ]);
  });

  it('static: clears and redraws on each change until interrupted', async () => {
    const { dir, file } = makeNote('# First\n');
    const terminal = createFakeTerminal({
      stdinIsTty: false,
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const { deps, state } = controlledDeps();

    const done = run(
      ['view', file, '--watch', '--color', 'never', '--width', '40'],
      terminal,
      { view: deps },
    );
    await settle();
    expect(state.watched).toEqual([file]);
    expect(terminal.outLines).toHaveLength(1);
    expect(terminal.outLines[0]).toMatch(/^\x1b\[2J\x1b\[H/);
    expect(terminal.outLines[0]).toContain('First');

    writeFileSync(file, '# Second\n', 'utf8');
    state.fire?.();
    await settle();
    expect(terminal.outLines).toHaveLength(2);
    expect(terminal.outLines[1]).toMatch(/^\x1b\[2J\x1b\[H/);
    expect(terminal.outLines[1]).toContain('Second');

    state.interrupt?.();
    expect(await done).toBe(0);
    expect(state.closed).toBe(true);
  });

  it('static: keeps the last render and says why once when the note goes missing', async () => {
    const { dir, file } = makeNote('# Here\n');
    const terminal = createFakeTerminal({
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const { deps, state } = controlledDeps();

    const done = run(['view', file, '--watch', '--color', 'never'], terminal, {
      view: deps,
    });
    await settle();
    rmSync(file);
    state.fire?.();
    await settle();
    state.fire?.();
    await settle();

    expect(terminal.outLines).toHaveLength(1);
    const reasons = terminal.errLines.filter((line) =>
      line.includes('note.mk.md'),
    );
    expect(reasons).toHaveLength(1);

    state.interrupt?.();
    expect(await done).toBe(0);
  });

  it('live: hands the viewer each new text', async () => {
    const { dir, file } = makeNote('# One\n');
    const terminal = createFakeTerminal({
      stdinIsTty: true,
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const seen: string[] = [];
    let fireRef: (() => void) | undefined;
    const { deps, state } = controlledDeps(async (input) => {
      const stop = input.onTextChange?.((text) => seen.push(text));
      fireRef = state.fire;
      writeFileSync(file, '# Two\n', 'utf8');
      fireRef?.();
      await settle();
      stop?.();
    });

    const exitCode = await run(['view', file, '--watch'], terminal, {
      view: deps,
    });

    expect(exitCode).toBe(0);
    expect(seen).toEqual(['# Two\n']);
    expect(state.closed).toBe(true);
  });

  it('live: without --watch the viewer gets no change hook', async () => {
    const { dir, file } = makeNote('# One\n');
    const terminal = createFakeTerminal({
      stdinIsTty: true,
      stdoutIsTty: true,
      env: { XDG_CONFIG_HOME: dir },
    });
    const inputs: MountLiveViewerInput[] = [];
    const { deps, state } = controlledDeps(async (input) => {
      inputs.push(input);
    });

    await run(['view', file], terminal, { view: deps });

    expect(inputs[0]?.onTextChange).toBeUndefined();
    expect(state.watched).toEqual([]);
  });
});

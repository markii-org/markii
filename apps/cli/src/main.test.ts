import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { run } from './main.js';
import { createFakeTerminal } from './test-terminal.js';

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

import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchNote, type WatchFs } from './watch-file.js';

/** A fake fs whose watch events and poll ticks the test fires by hand. */
function fakeFs(options: { watchThrows?: boolean; isDirectory?: boolean }) {
  const state: {
    watchedTarget?: string;
    recursive?: boolean;
    emit?: (filename: string | null) => void;
    fail?: () => void;
    nativeClosed: boolean;
    pollTarget?: string;
    poll?: (current: Partial<Stats>, previous: Partial<Stats>) => void;
    unwatched: string[];
  } = { nativeClosed: false, unwatched: [] };
  const fs: WatchFs = {
    statSync: () => ({ isDirectory: () => options.isDirectory === true }),
    watch: (target, opts, listener) => {
      if (options.watchThrows) throw new Error('ENOSYS');
      state.watchedTarget = target;
      state.recursive = opts.recursive;
      state.emit = (filename) => listener('change', filename);
      return {
        close: () => {
          state.nativeClosed = true;
        },
        on: (_event, handler) => {
          state.fail = () => handler(new Error('EIO'));
          return undefined;
        },
      };
    },
    watchFile: (target, _opts, listener) => {
      state.pollTarget = target;
      state.poll = (current, previous) =>
        listener(current as Stats, previous as Stats);
    },
    unwatchFile: (target) => {
      state.unwatched.push(target);
    },
  };
  return { fs, state };
}

describe('watchNote with fs.watch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("watches the note's directory and fires once per burst of events on its name", () => {
    vi.useFakeTimers();
    const { fs, state } = fakeFs({});
    const onChange = vi.fn();
    const watcher = watchNote('/notes/a.mk.md', onChange, {
      fs,
      debounceMs: 50,
    });

    expect(state.watchedTarget).toBe('/notes');
    expect(state.recursive).toBe(false);
    state.emit?.('a.mk.md');
    state.emit?.('a.mk.md');
    vi.advanceTimersByTime(30);
    state.emit?.('a.mk.md');
    vi.advanceTimersByTime(49);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it('ignores events for other files in the directory', () => {
    vi.useFakeTimers();
    const { fs, state } = fakeFs({});
    const onChange = vi.fn();
    watchNote('/notes/a.mk.md', onChange, { fs, debounceMs: 10 });
    state.emit?.('b.mk.md');
    state.emit?.('.a.mk.md.swp');
    vi.advanceTimersByTime(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('watches a directory bundle itself, recursively, and any event counts', () => {
    vi.useFakeTimers();
    const { fs, state } = fakeFs({ isDirectory: true });
    const onChange = vi.fn();
    watchNote('/notes/bundle', onChange, { fs, debounceMs: 10 });
    expect(state.watchedTarget).toBe('/notes/bundle');
    expect(state.recursive).toBe(true);
    state.emit?.('scripts/fetch.lua');
    vi.advanceTimersByTime(10);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('close() cancels a pending change and stops the watch', () => {
    vi.useFakeTimers();
    const { fs, state } = fakeFs({});
    const onChange = vi.fn();
    const watcher = watchNote('/notes/a.mk.md', onChange, {
      fs,
      debounceMs: 10,
    });
    state.emit?.('a.mk.md');
    watcher.close();
    vi.advanceTimersByTime(100);
    expect(onChange).not.toHaveBeenCalled();
    expect(state.nativeClosed).toBe(true);
  });
});

describe('watchNote polling fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls when fs.watch throws, firing on an mtime or size change only', () => {
    vi.useFakeTimers();
    const { fs, state } = fakeFs({ watchThrows: true });
    const onChange = vi.fn();
    const watcher = watchNote('/notes/a.mk.md', onChange, {
      fs,
      debounceMs: 10,
    });
    expect(state.pollTarget).toBe('/notes/a.mk.md');

    state.poll?.({ mtimeMs: 1, size: 5 }, { mtimeMs: 1, size: 5 });
    vi.advanceTimersByTime(20);
    expect(onChange).not.toHaveBeenCalled();

    state.poll?.({ mtimeMs: 2, size: 5 }, { mtimeMs: 1, size: 5 });
    vi.advanceTimersByTime(20);
    expect(onChange).toHaveBeenCalledTimes(1);

    watcher.close();
    expect(state.unwatched).toEqual(['/notes/a.mk.md']);
  });

  it('switches to polling when fs.watch reports an error later', () => {
    vi.useFakeTimers();
    const { fs, state } = fakeFs({});
    const onChange = vi.fn();
    watchNote('/notes/a.mk.md', onChange, { fs, debounceMs: 10 });
    expect(state.pollTarget).toBeUndefined();
    state.fail?.();
    expect(state.nativeClosed).toBe(true);
    expect(state.pollTarget).toBe('/notes/a.mk.md');
    state.poll?.({ mtimeMs: 1, size: 6 }, { mtimeMs: 1, size: 5 });
    vi.advanceTimersByTime(10);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('watchNote on the real filesystem', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sees a save that renames a temporary file over the note', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'markii-cli-watch-'));
    dirs.push(dir);
    const file = path.join(dir, 'note.mk.md');
    writeFileSync(file, '# One\n');
    let changes = 0;
    const watcher = watchNote(
      file,
      () => {
        changes += 1;
      },
      { debounceMs: 30 },
    );
    try {
      const temp = path.join(dir, '.note.mk.md.tmp');
      writeFileSync(temp, '# Two\n');
      renameSync(temp, file);
      for (let i = 0; i < 100 && changes === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(changes).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
    }
  });
});

/**
 * Watches a note for `markii view --watch`. `fs.watch` is the primary
 * signal, with a debounce, because an editor's save is often several events
 * (truncate, write, rename). It watches the note's DIRECTORY filtered by the
 * note's name rather than the file itself, so an editor that saves by
 * writing a temporary file and renaming it over the note keeps being seen;
 * a watch on the original file would follow the replaced inode and go
 * quiet. A directory bundle is watched recursively.
 *
 * When `fs.watch` is unavailable (it throws, or reports an error later, as
 * it can on some network and container filesystems), the watcher falls
 * back to polling the path's modification time and size.
 *
 * The filesystem is injected so the tests can drive both paths without
 * real timing, and this module reads nothing from `process`.
 */
import * as nodeFs from 'node:fs';
import * as path from 'node:path';

export interface FileWatcher {
  close(): void;
}

interface NativeWatcher {
  close(): void;
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

/** The slice of `node:fs` this module uses. */
export interface WatchFs {
  watch(
    target: string,
    options: { recursive: boolean },
    listener: (event: string, filename: string | Buffer | null) => void,
  ): NativeWatcher;
  watchFile(
    target: string,
    options: { interval: number },
    listener: (current: nodeFs.Stats, previous: nodeFs.Stats) => void,
  ): void;
  unwatchFile(target: string): void;
  statSync(target: string): { isDirectory(): boolean };
}

export interface WatchNoteOptions {
  /** Quiet period after the last event before `onChange` fires. */
  readonly debounceMs?: number;
  /** Polling interval for the fallback. */
  readonly pollIntervalMs?: number;
  readonly fs?: WatchFs;
}

const DEFAULT_DEBOUNCE_MS = 120;
const DEFAULT_POLL_INTERVAL_MS = 500;

export function watchNote(
  target: string,
  onChange: () => void,
  options: WatchNoteOptions = {},
): FileWatcher {
  const fs: WatchFs = options.fs ?? nodeFs;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let native: NativeWatcher | undefined;
  let polling = false;

  const schedule = (): void => {
    if (closed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) onChange();
    }, debounceMs);
  };

  const startPolling = (): void => {
    if (polling || closed) return;
    polling = true;
    fs.watchFile(target, { interval: pollIntervalMs }, (current, previous) => {
      if (
        current.mtimeMs !== previous.mtimeMs ||
        current.size !== previous.size
      ) {
        schedule();
      }
    });
  };

  let isDirectory = false;
  try {
    isDirectory = fs.statSync(target).isDirectory();
  } catch {
    // A missing note is reported by the read that follows a change; the
    // watch itself still goes on the parent directory.
  }
  const watched = isDirectory ? target : path.dirname(target);
  const name = path.basename(target);

  try {
    native = fs.watch(
      watched,
      { recursive: isDirectory },
      (_event, filename) => {
        if (isDirectory || filename === null) {
          schedule();
          return;
        }
        if (filename.toString() === name) schedule();
      },
    );
    native.on('error', () => {
      native?.close();
      native = undefined;
      startPolling();
    });
  } catch {
    native = undefined;
    startPolling();
  }

  return {
    close(): void {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      native?.close();
      if (polling) fs.unwatchFile(target);
    },
  };
}

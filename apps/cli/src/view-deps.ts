/**
 * The seam `markii view`'s live path mounts through, kept as its own
 * module so `main.test.ts` can override it without a real terminal.
 * `main.ts` owns the real implementation (it is the only module allowed to
 * read `process`); this module only declares the shape.
 */
import type { AnsiValueStore } from '@markii/ansi';
import type { OnDiagnostic } from '@markii/stdlib';
import type { BoxFlag, ColorFlag } from './args.js';
import type { Terminal } from './terminal.js';

export interface MountLiveViewerInput {
  readonly text: string;
  readonly terminal: Pick<Terminal, 'env' | 'stdoutIsTty' | 'columns'>;
  readonly widthFlag?: number;
  readonly colorFlag?: ColorFlag;
  readonly boxFlag?: BoxFlag;
  readonly store: AnsiValueStore;
  readonly onDiagnostic: OnDiagnostic;
  /**
   * `--watch`: registers a listener the caller calls with the note's new
   * text after each change on disk, and returns a function that removes it.
   * The viewer re-renders in place, so focus and open state survive.
   */
  readonly onTextChange?: (listener: (text: string) => void) => () => void;
}

/** A started watch on a note; `close` stops it. */
export interface NoteWatch {
  close(): void;
}

export interface ViewDeps {
  readonly mountLiveViewer: (input: MountLiveViewerInput) => Promise<void>;
  /** Calls `onChange` (debounced) whenever the note at `absolutePath` changes. */
  readonly watchNote?: (
    absolutePath: string,
    onChange: () => void,
  ) => NoteWatch;
  /** Resolves when the user interrupts (Ctrl+C) a static `--watch`. */
  readonly untilInterrupted?: () => Promise<void>;
}

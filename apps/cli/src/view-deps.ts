/**
 * The seam `markii view`'s live path mounts through, kept as its own
 * module so `main.test.ts` can override it without a real terminal.
 * `main.ts` owns the real implementation (it is the only module allowed to
 * read `process`); this module only declares the shape.
 */
import type { AnsiValueStore } from '@markii/ansi';
import type { OnDiagnostic } from '@markii/stdlib';
import type { ColorFlag } from './args.js';
import type { Terminal } from './terminal.js';

export interface MountLiveViewerInput {
  readonly text: string;
  readonly terminal: Pick<Terminal, 'env' | 'stdoutIsTty' | 'columns'>;
  readonly widthFlag?: number;
  readonly colorFlag?: ColorFlag;
  readonly store: AnsiValueStore;
  readonly onDiagnostic: OnDiagnostic;
}

export interface ViewDeps {
  readonly mountLiveViewer: (input: MountLiveViewerInput) => Promise<void>;
}

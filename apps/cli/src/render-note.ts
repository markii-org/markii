/**
 * The one call into `@markii/ansi`. Resolves width and color from a
 * `Terminal`'s plain values (never the environment itself, which is
 * `@markii/ansi`'s own rule — see `detectColorLevel`'s doc comment) and
 * routes `onDiagnostic` lines to a collector the caller decides whether to
 * print.
 */
import {
  detectColorLevel,
  renderMarkToAnsi,
  resolveColorOption,
  type AnsiValueStore,
  type ColorLevel,
  type ColorOption,
} from '@markii/ansi';
import type { OnDiagnostic } from '@markii/stdlib';
import type { ColorFlag } from './args.js';
import type { Terminal } from './terminal.js';

const DEFAULT_WIDTH = 80;

/** `--width` flag, else the terminal's own column count, else 80. */
export function resolveWidth(
  widthFlag: number | undefined,
  terminal: Pick<Terminal, 'columns'>,
): number {
  if (widthFlag !== undefined) return widthFlag;
  if (terminal.columns !== undefined && terminal.columns > 0) {
    return terminal.columns;
  }
  return DEFAULT_WIDTH;
}

/**
 * `--color` flag, else auto-detected from the terminal's environment and
 * TTY-ness. `'auto'` and `undefined` both mean "detect"; every other value
 * (including `'never'`) goes straight through `@markii/ansi`'s own
 * `resolveColorOption`.
 */
export function resolveColor(
  colorFlag: ColorFlag | undefined,
  terminal: Pick<Terminal, 'env' | 'stdoutIsTty'>,
): ColorLevel {
  if (colorFlag === undefined || colorFlag === 'auto') {
    return detectColorLevel(terminal.env, terminal.stdoutIsTty);
  }
  return resolveColorOption(colorFlag as ColorOption);
}

/** `@markii/ansi`'s `RenderMarkOptions.color` is a `ColorOption` ('auto'/'never'/level), while this module resolves all the way to a final `ColorLevel`. `'never'` is the ColorOption that reliably resolves back to `'none'` through the engine's own `resolveColorOption` (see that function's doc comment: `'auto'` and `'never'` both mean "no escapes" to the engine, since it has no environment knowledge of its own); every other level passes through unchanged. */
function colorLevelToOption(level: ColorLevel): ColorOption {
  return level === 'none' ? 'never' : level;
}

export interface RenderNoteOptions {
  readonly widthFlag?: number;
  readonly colorFlag?: ColorFlag;
  readonly store?: AnsiValueStore;
  /**
   * `@markii/stdlib`'s `OnDiagnostic` — the caller wires this to
   * `@markii/host`'s `createRenderDiagnosticCollector()` (or an equivalent
   * reporter) so a quiet render-time issue reaches the CLI's diagnostics
   * surface (stderr, gated behind `--verbose` for `markii view`, always for
   * `markii export`) without ever reaching stdout.
   */
  readonly onDiagnostic?: OnDiagnostic;
}

/** Renders `text` to a plain string for the terminal, resolving width and color from `terminal` and `options`. */
export function renderNote(
  text: string,
  terminal: Terminal,
  options: RenderNoteOptions = {},
): string {
  const width = resolveWidth(options.widthFlag, terminal);
  const color = resolveColor(options.colorFlag, terminal);
  return renderMarkToAnsi(text, undefined, options.store, undefined, {
    width,
    color: colorLevelToOption(color),
    ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
  });
}

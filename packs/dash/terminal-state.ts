import type { AnsiRenderContext } from '@markii/ansi';

/**
 * The quiet binding marker every data-bound terminal view of this pack
 * shares: the engine's own trailing text for a failed or stale binding
 * (`ctx.dataSuffix`, which carries the engine's wording), dimmed, and `''`
 * for a fresh or never-produced one. The full failure reason reaches the
 * host's diagnostics surface through the run, not this text.
 */
export function bindingMarker(ctx: AnsiRenderContext): string {
  const suffix = ctx.dataSuffix?.trim() ?? '';
  return suffix === '' ? '' : ctx.dim(suffix);
}

/** Joins the non-empty parts with two spaces. */
export function joinParts(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join('  ');
}

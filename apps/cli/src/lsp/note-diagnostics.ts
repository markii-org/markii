/**
 * A note's findings for the language server: one render through
 * `@markii/ansi` with an `onDiagnostic` callback, so the editor shows what
 * the viewer would have drawn as a quiet marker (an invalid attribute
 * value, a block component written inline, an unsafe image source, a pack
 * component with no terminal view) and, with `reportUnknownDirectives`,
 * the directives that name nothing. The wording is the engine's own
 * failure-presentation text; this module adds none.
 *
 * No store and no vault are passed, so no value resolves and nothing runs:
 * a note's scripts never execute from here.
 */
import { renderMarkToAnsi, type AnsiRegistry } from '@markii/ansi';
import type { DiagnosticEvent, UnavailableComponent } from '@markii/stdlib';

export interface NoteDiagnosticsOptions {
  readonly registry: AnsiRegistry;
  readonly unavailable: readonly UnavailableComponent[];
}

export async function noteDiagnostics(
  text: string,
  options: NoteDiagnosticsOptions,
): Promise<DiagnosticEvent[]> {
  const events: DiagnosticEvent[] = [];
  await renderMarkToAnsi(text, options.registry, undefined, undefined, {
    color: 'never',
    width: 80,
    unavailableComponents: options.unavailable,
    reportUnknownDirectives: true,
    onDiagnostic: (event) => {
      events.push(event);
    },
  });
  return events;
}

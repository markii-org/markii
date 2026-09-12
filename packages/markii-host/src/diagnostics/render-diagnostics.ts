/**
 * The one place a render-time diagnostic event becomes a line on a host's
 * diagnostics surface (docs/integration.md's host checklist, item 9).
 *
 * Both renderers report a quiet in-page marker through their `onDiagnostic`
 * render option (`@markii/stdlib`'s `DiagnosticEvent`). The marker alone
 * satisfies half of AGENTS.md's "clean is not silent" rule: the other half
 * is a full diagnostic somewhere a reader can find without opening
 * developer tools. This module turns one event into the line both hosts
 * write, so the VS Code output channel and the Obsidian console cannot word
 * the same finding differently.
 *
 * Node-free, so `../browser.ts` can export it to a browser bundle (the VS
 * Code webview, which is where the React render actually runs).
 */
import type { DiagnosticEvent, OnDiagnostic } from '@markii/stdlib';

/** The prefix every render-diagnostic line carries, so a reader can tell it from a pack or run line in the same log. */
const RENDER_DIAGNOSTIC_PREFIX = 'Render';

/**
 * One diagnostic event as a single line. The event's own `message` is the
 * engine's failure-presentation wording, reused verbatim rather than
 * reworded here; this only adds who it happened to.
 */
export function renderDiagnosticLine(event: DiagnosticEvent): string {
  const where =
    event.directive === undefined
      ? ''
      : event.attribute === undefined
        ? ` in ${event.directive}`
        : ` in ${event.directive}'s ${event.attribute}`;
  return `${RENDER_DIAGNOSTIC_PREFIX}${where}: ${event.message}`;
}

/**
 * An `onDiagnostic` callback that writes each DISTINCT line once through
 * `log`. A preview re-renders on every keystroke, and a note with one bad
 * attribute value would otherwise write the same line hundreds of times
 * into a log a reader is supposed to be able to scan. The dedupe is per
 * collector, so a host creates one per note and drops it when the note
 * closes.
 */
export function createRenderDiagnosticReporter(
  log: (line: string) => void,
): OnDiagnostic {
  const reported = new Set<string>();
  return (event) => {
    const line = renderDiagnosticLine(event);
    if (reported.has(line)) return;
    reported.add(line);
    log(line);
  };
}

/**
 * A collector for a host that cannot log during the render itself, such as
 * a webview that has to post its findings to an extension host afterwards.
 * `onDiagnostic` goes to the render; `lines()` is read once the render has
 * returned, already deduped and in the order the renderer found them.
 */
export function createRenderDiagnosticCollector(): {
  readonly onDiagnostic: OnDiagnostic;
  readonly lines: () => string[];
} {
  const collected: string[] = [];
  const onDiagnostic = createRenderDiagnosticReporter((line) => {
    collected.push(line);
  });
  return { onDiagnostic, lines: () => [...collected] };
}

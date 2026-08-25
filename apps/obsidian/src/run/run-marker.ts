/**
 * This plugin's presentation for a run's recorded outcome
 * (`@markii/host`'s `run/run-trace.ts` `RunTrace`) — the quiet marker
 * AGENTS.md's cleanliness principle calls for: "ran 2m ago" / "run failed
 * 2m ago" under the rendered note, never a raw error dump. Mirrors
 * `apps/vscode/src/webview/run-marker.ts` exactly (same relative-time
 * coarsening, same two-line label/title split) without importing it — that
 * file is a different app's webview-local module and is explicitly not to
 * be modified; this is this host's own copy of the same presentation
 * contract, wording lives in one place PER HOST.
 *
 * `obsidian`-free so it stays unit-testable with Vitest.
 */

/** The minimal shape this module needs off a `RunTrace` (`@markii/host`) — kept separate so this file never has to import a `RunTrigger` type it does not use. */
export interface RunMarkerInput {
  readonly ranAt: number;
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * A short, human relative-time phrase for `deltaMs` (a non-negative
 * duration since the run, in milliseconds): "just now" under a minute, then
 * minutes, then hours, then days. A negative delta (clock skew) is clamped
 * to "just now".
 */
export function formatRelativeAgo(deltaMs: number): string {
  const clamped = Math.max(0, deltaMs);
  const seconds = Math.floor(clamped / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** The marker's visible text: "ran <relative>" on success, "run failed <relative>" otherwise. */
export function runMarkerLabel(trace: RunMarkerInput, now: number): string {
  const relative = formatRelativeAgo(now - trace.ranAt);
  return trace.ok ? `ran ${relative}` : `run failed ${relative}`;
}

/** The marker's `title` tooltip: the failure reason for a failed run (out of the text flow), or `undefined` for a successful run. */
export function runMarkerTitle(trace: RunMarkerInput): string | undefined {
  if (trace.ok) return undefined;
  return trace.reason ? `run failed: ${trace.reason}` : 'run failed';
}

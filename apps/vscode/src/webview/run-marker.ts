/**
 * ITEM 3's webview-side presentation for a run's recorded outcome
 * (`../run/run-trace.ts`'s `RunTrace`, carried over the wire as
 * `protocol.ts`'s `UpdateMessage.lastRun`). Wording lives here — the one
 * home of this marker's text — mirroring how `@markii/react`'s
 * `failure-presentation.ts` is the one home of the renderer's own failure
 * wording; this is the VS Code host's equivalent for a host-specific
 * concern the renderer itself knows nothing about.
 *
 * A relative label ("ran 2m ago") rather than a raw timestamp, per the
 * task: relative time is preferable and consistent with how `--stale`
 * already presents "this is not current" without spelling out a clock time.
 */

/** The minimal shape this module needs off a wire-carried run trace — kept separate from `../run/run-trace.ts`'s `RunTrace` so this file never has to import a `RunTrigger` type it does not use. */
export interface RunMarkerInput {
  readonly ranAt: number;
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * A short, human relative-time phrase for `deltaMs` (a non-negative
 * duration since the run, in milliseconds): "just now" under a minute,
 * then minutes, then hours, then days — the same coarsening a chat client's
 * timestamps use. A negative delta (a clock skew between host and webview)
 * is clamped to "just now" rather than producing a nonsensical negative
 * count.
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

/** The marker's visible text: "ran <relative>" when the run succeeded, "run failed <relative>" otherwise. */
export function runMarkerLabel(trace: RunMarkerInput, now: number): string {
  const relative = formatRelativeAgo(now - trace.ranAt);
  return trace.ok ? `ran ${relative}` : `run failed ${relative}`;
}

/** The marker's `title` tooltip: the failure reason for a failed run (out of the text flow, per AGENTS.md's cleanliness principle), or `undefined` for a successful run (nothing to explain). */
export function runMarkerTitle(trace: RunMarkerInput): string | undefined {
  if (trace.ok) return undefined;
  return trace.reason ? `run failed: ${trace.reason}` : 'run failed';
}

/**
 * The neutral shape of a render-time diagnostic event (docs/integration.md):
 * something a renderer recognized and handled by rendering a quiet marker
 * instead of silently dropping content or failing outright, reported
 * through a render engine's `onDiagnostic` option so a host can route it to
 * its own diagnostics surface (AGENTS.md's "clean is not silent" rule: a
 * quiet in-page marker alone is not enough, the reason must also reach a
 * surface a host actually shows).
 *
 * Both platform renderers (`@markii/react`, `@markii/html`) emit this exact
 * shape from their own independent implementations, so a host wiring up
 * one engine's callback needs no engine-specific branching if it later
 * adds the other. The WORDING in `message` is produced by each engine's own
 * `failure-presentation` module (the one home of failure wording per
 * engine) — this module only defines the envelope, never the words.
 */

/**
 * `'invalid-attribute-value'` — a known attribute (one `@markii/stdlib`'s
 * component contracts declare) received a value outside its closed enum;
 * the component still rendered, with a quiet marker.
 *
 * `'unsafe-image-src'` — a component-built `<img>` (the standard `figure`)
 * had its `src` refused as an unsafe URL scheme; the component rendered
 * without the image, with a quiet marker.
 */
export type DiagnosticKind = 'invalid-attribute-value' | 'unsafe-image-src';

export interface DiagnosticEvent {
  readonly kind: DiagnosticKind;
  /** The directive name the event happened on, when there is a single unambiguous one. */
  readonly directive?: string;
  /** The attribute name involved, for `'invalid-attribute-value'`. Absent for a kind with no single attribute to name. */
  readonly attribute?: string;
  /** The same human-readable text the in-page marker's tooltip carries. */
  readonly message: string;
}

export type OnDiagnostic = (event: DiagnosticEvent) => void;

/**
 * Calls `onDiagnostic` with `event`, swallowing any exception it throws.
 * A host-supplied callback must never be able to break rendering — the same
 * never-throw guarantee every other render-time hook in this format carries
 * (Architecture rule 3's spirit, extended to a host's own code). Both
 * engines call this instead of invoking `onDiagnostic` directly, so the
 * guard cannot drift between them.
 */
export function reportDiagnostic(
  onDiagnostic: OnDiagnostic | undefined,
  event: DiagnosticEvent,
): void {
  if (!onDiagnostic) return;
  try {
    onDiagnostic(event);
  } catch {
    // A throwing callback must never break rendering.
  }
}

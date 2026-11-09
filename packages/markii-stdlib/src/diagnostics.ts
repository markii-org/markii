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
 *
 * `'form-mismatch'` — a registered block component was written as an
 * inline directive (`:callout[x]`); it rendered as the inline fallback
 * marker instead of the component.
 *
 * `'no-engine-view'` — a directive names a component of an INSTALLED pack
 * that ships no view for this render engine (a React-only pack in the
 * terminal, a terminal-only component in an editor preview). It rendered
 * the fallback box, labeled as a missing view rather than an unknown
 * component. Only reported when the host passed `unavailableComponents`.
 */
export type DiagnosticKind =
  | 'invalid-attribute-value'
  | 'unsafe-image-src'
  | 'form-mismatch'
  | 'no-engine-view';

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

/**
 * One component of an installed pack that the current render cannot draw,
 * as plain data a host hands to a renderer's `unavailableComponents`
 * option. The renderer uses it only to tell this case apart from a typo:
 * the fallback box keeps its structure and the label changes.
 *
 * `directive` is the composed directive name (`ana_meter`), `pack` the
 * pack's namespace, and `engines` the engine ids (`react`, `ansi`) the
 * component DOES ship a view for.
 *
 * `loadFailed` marks a component whose pack could not be loaded for this
 * render's engine at all (its view script threw, registered nothing, or
 * registered another namespace). The renderer then words the fallback as a
 * failed pack rather than a missing view. Absent means the pack loaded and
 * simply has no view for the component.
 */
export interface UnavailableComponent {
  readonly directive: string;
  readonly pack: string;
  readonly engines: readonly string[];
  readonly loadFailed?: true;
}

/** A lookup from a directive name to its `UnavailableComponent`, or `undefined`. */
export type UnavailableComponentLookup = (
  directive: string,
) => UnavailableComponent | undefined;

/**
 * Builds the lookup a renderer queries per directive. Backed by a `Map`
 * (never a plain object), so a directive named `constructor` or
 * `__proto__` cannot resolve through the prototype chain. An omitted or
 * empty list gives `undefined`, so a renderer given no option takes
 * exactly the path it took before the option existed. Entries that are not
 * well-formed are skipped, and the first entry for a name wins.
 */
export function createUnavailableComponentLookup(
  components: readonly UnavailableComponent[] | undefined,
): UnavailableComponentLookup | undefined {
  if (!Array.isArray(components) || components.length === 0) return undefined;
  const byName = new Map<string, UnavailableComponent>();
  for (const entry of components as readonly unknown[]) {
    if (entry === null || typeof entry !== 'object') continue;
    const { directive, pack, engines, loadFailed } = entry as Record<
      string,
      unknown
    >;
    if (typeof directive !== 'string' || typeof pack !== 'string') continue;
    if (!Array.isArray(engines)) continue;
    if (byName.has(directive)) continue;
    byName.set(directive, {
      directive,
      pack,
      engines: engines.filter((e): e is string => typeof e === 'string'),
      ...(loadFailed === true ? { loadFailed: true as const } : {}),
    });
  }
  if (byName.size === 0) return undefined;
  return (directive) => byName.get(directive);
}

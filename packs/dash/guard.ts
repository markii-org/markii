/**
 * Shared defensive helpers for the `dash` pack.
 *
 * The reference renderer's own `safe-data`/`failure-presentation` modules
 * are internal to `@markii/react` (not exported through the package's
 * subpaths), and a third-party pack must bring its own hostile-value
 * discipline anyway: spec §4 requires a component to never throw on a
 * misbehaving host value, and a pack's internals are the embedding app's
 * to guard. Every `dash_*` component therefore routes all extraction of
 * its bound `data` through `safeExtract`, only ever lets primitives
 * (strings and finite numbers) escape the guard, and surfaces a failed or
 * stale binding exactly the way the reference components do: a `title`
 * tooltip and a CSS modifier class, never body text.
 */

/** Coerces an unknown value to a finite number, or `fallback`. Unlike `int`, keeps sign and fractional part — gauges and deltas both need negative and non-integer values. */
export function num(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Coerces an unknown value to a string, or `fallback`. */
export function str(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback;
}

/**
 * Runs `read` — an extraction that touches an untrusted bound `data`
 * value — and falls back to `fallback()` if any part of it throws. The
 * whole extraction is wrapped rather than each property read, mirroring
 * `@markii/react`'s internal `safeRead`: a value whose reads throw is
 * unreadable as a whole, so a half-collected result would be arbitrary
 * rather than useful. `read` must return only values derived from the
 * bound data (strings, numbers, plain arrays of them), never the hostile
 * object itself; `fallback` must not touch the bound value at all.
 */
export function safeExtract<T>(
  read: () => T,
  fallback: () => T,
): { fields: T; fault?: string } {
  try {
    return { fields: read() };
  } catch (err) {
    return { fields: fallback(), fault: describeFault(err) };
  }
}

/**
 * Best-effort description of something host data threw, for the tooltip
 * channel. Every step is itself guarded: `instanceof`, `.message`, and
 * `String(...)` can all throw when the thrown value is a revoked `Proxy`
 * or an object with hostile traps.
 */
function describeFault(err: unknown): string {
  const generic = 'value store threw while reading this name';
  try {
    if (err instanceof Error && err.message !== '') return err.message;
    const text = String(err);
    return text === '' ? generic : text;
  } catch {
    return generic;
  }
}

/**
 * The tooltip text for a failed binding: the store's own error message
 * when the run failed, otherwise the fault a hostile value produced
 * during extraction. Never returns an empty string, so the result can go
 * straight to `title=` without producing an empty tooltip.
 */
export function failureTitle(
  error: string | undefined,
  fault: string | undefined,
): string | undefined {
  const message = error ?? fault;
  return message !== undefined && message !== '' ? message : undefined;
}

/**
 * The class list for a data-bound component's root element: `base`, plus
 * `--stale`/`--error` modifiers mirroring the reference components' status
 * hooks, so a stylesheet can tint a binding that is not "fresh right now".
 * Class names only — the visible body of the component never changes.
 */
export function stateClassName(
  base: string,
  status: string | undefined,
): string {
  if (status === 'stale') return `${base} ${base}--stale`;
  if (status === 'error') return `${base} ${base}--error`;
  return base;
}

/**
 * Whether a binding is unreadable: the store never produced it ('missing')
 * or the producing script failed ('error'). Both render the component's
 * ordinary quiet empty state.
 */
export function isUnreadable(status: string | undefined): boolean {
  return status === 'missing' || status === 'error';
}

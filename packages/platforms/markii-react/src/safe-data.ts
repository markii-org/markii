/**
 * The ONE home for reading data that came from a host — a `ValueStore`/
 * `VaultStore` entry, or the arbitrary value a `data=` binding resolved to.
 * Such a value is typed at compile time and completely untrusted at runtime:
 * it may be a revoked `Proxy`, an object with throwing getters, or a `Proxy`
 * whose `get`/`has`/`getOwnPropertyDescriptor` traps throw. Reading ANY
 * property of it — including `Array.isArray`, which performs an `IsArray`
 * check a revoked proxy rejects, and `for...of`, which drives the whole
 * iterator protocol through the `get` trap — can throw.
 *
 * The renderer's never-throw guarantee (docs/spec.md §4) has to hold across
 * all of that, so every such read goes through here rather than each
 * call site inventing its own `try`/`catch` — the same "one home" posture
 * `./components/failure-presentation` takes for failure wording.
 *
 * Scope boundary: this covers the resolution layer and the reference
 * data-bound components (`stat`/`progress`/`chart`), which are ours and must
 * exemplify the contract. A THIRD-PARTY registry component that throws while
 * reading its own `data` prop remains the embedding app's to guard — the
 * renderer cannot reach inside someone else's component.
 */

/**
 * The message a host-data fault falls back to when even describing the
 * thrown value throws (a revoked `Proxy` as the thrown thing, an `Error`
 * subclass with a throwing `message` getter, ...). Deliberately generic: it
 * only ever reaches a tooltip.
 */
const HOST_FAULT_MESSAGE = 'value store threw while reading this name';

/**
 * Best-effort description of something host data threw, for the tooltip
 * channel. Every step is itself guarded: `instanceof`, `.message`, and
 * `String(...)` can ALL throw when the thrown value is a revoked `Proxy` or
 * an object with hostile traps/getters, and a never-throw renderer cannot
 * afford to trust any of them.
 */
export function describeHostFault(err: unknown): string {
  try {
    if (err instanceof Error) {
      const { message } = err;
      if (typeof message === 'string' && message !== '') return message;
    }
    const text = String(err);
    return text === '' ? HOST_FAULT_MESSAGE : text;
  } catch {
    return HOST_FAULT_MESSAGE;
  }
}

/** What `safeRead` produces: the extracted fields, plus the thrown message when the extraction had to be abandoned. */
export interface SafeRead<T> {
  /** `read()`'s result, or `fallback()`'s if `read` threw. Never derived from an unread hostile value. */
  fields: T;
  /**
   * The message a hostile read threw, present ONLY when `fallback` was used.
   * Feeds the existing tooltip channel (`failureTitle`'s `error` argument),
   * exactly as a store-level fault already does for `:value[...]` — so the
   * same misbehaving store explains itself identically whether it is read
   * inline or through a data-bound component. It is NOT a `FailureKind`: a
   * misbehaving host is not a member of the script-failure taxonomy, and no
   * kind is ever invented for one.
   */
  fault?: string;
}

/**
 * Runs `read` — an extraction that touches an untrusted bound `data` value —
 * and falls back to `fallback()` if any part of it throws.
 *
 * Wrapping the WHOLE extraction, rather than each individual property read,
 * is deliberate: a value whose reads throw is unreadable as a whole, so a
 * half-collected result (three of five stat fields; the first four of a
 * hostile array's points) would be arbitrary rather than useful. All-or-
 * nothing keeps the degraded state identical to the ordinary "nothing
 * resolved" state every one of these components already renders.
 *
 * `read` must return only values DERIVED from the bound data (strings,
 * numbers, plain arrays of numbers) and never the hostile object itself,
 * so nothing that can throw escapes this boundary. `fallback` must not
 * touch the bound value at all — it exists so a component can still honor
 * its static attributes (e.g. `chart`'s `values=`) when the binding is
 * unreadable; it is not itself guarded.
 */
export function safeRead<T>(read: () => T, fallback: () => T): SafeRead<T> {
  try {
    return { fields: read() };
  } catch (err) {
    return { fields: fallback(), fault: describeHostFault(err) };
  }
}

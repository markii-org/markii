/**
 * Marks an `Error` as a network POLICY refusal (an unlisted host, a refused
 * address range, an over-size body) as opposed to a transport failure (DNS,
 * connection, timeout, abort).
 *
 * The brand is a global `Symbol.for` key on the error object, so it needs no
 * runtime import and survives being created in one bundle and read in
 * another. The net bridge reads it to decide whether a failure crosses to
 * the worker as a capability denial or as an ordinary runtime failure. A
 * refusal is always an error: a script can never read one as a success.
 *
 * It is a plain property, not a classification the Lua side trusts: the
 * worker rebuilds its own branded denial from the `denied` flag on the wire.
 */
const NET_REFUSAL: unique symbol = Symbol.for('markii.net.refusal') as never;

/** Returns `error` marked as a policy refusal. A network provider throws one for every request it refuses on policy grounds. */
export function netRefusal(error: Error): Error {
  return Object.assign(error, { [NET_REFUSAL]: true as const });
}

/** True when `error` was marked by {@link netRefusal}. */
export function isNetRefusal(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { [NET_REFUSAL]?: unknown })[NET_REFUSAL] === true
  );
}

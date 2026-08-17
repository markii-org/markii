/**
 * The closed, runtime-owned failure taxonomy for a script execution outcome
 * (docs/scripting.md). This is the ONE vocabulary every concrete `ScriptExecutor`
 * (e.g. `@markii/lua`'s `createLuaExecutor`) is expected to map its own
 * language-specific failure shape down to, and the one vocabulary
 * `@markii/react` (and any other renderer) is expected to branch its
 * presentation on. No UI text lives in this package — `normalizeFailureKind`
 * only classifies; a renderer decides what each kind is called on screen.
 *
 * - `'script-error'`      — the script itself threw, had a syntax error, or
 *   returned a value that couldn't be marshaled back out. The default/
 *   fallback bucket: anything not clearly one of the other three lands here,
 *   INCLUDING a value this package cannot trust (see `normalizeFailureKind`).
 * - `'capability-denied'` — the grant was absent, or the host actively
 *   refused (an ungranted net host, a bundle path-jail rejection, a
 *   fetch-size cap). The script asked for something it was never allowed.
 * - `'tier-blocked'`      — the capability genuinely exists in the granted
 *   set, but the CURRENT execution tier forbids exercising it (an effectful
 *   op — `net.post`, `bundle.write` — attempted under the read-only
 *   `'auto'`/`'scheduled'` tier). Distinct from `'capability-denied'`: a
 *   manual run of the exact same script, with the exact same grants, would
 *   succeed.
 * - `'limit'`             — a resource limit was breached: instruction
 *   count, wall-clock, or memory. The run was killed, not refused.
 */
export type FailureKind =
  'script-error' | 'capability-denied' | 'tier-blocked' | 'limit';

/** Every valid `FailureKind`, for exhaustive iteration/validation. Keep in sync with the `FailureKind` union by construction — see `normalizeFailureKind`'s runtime check against this exact tuple. */
export const FAILURE_KINDS = [
  'script-error',
  'capability-denied',
  'tier-blocked',
  'limit',
] as const satisfies readonly FailureKind[];

/**
 * Normalizes an arbitrary, UNTRUSTED value into a `FailureKind`. This is the
 * boundary guard for the whole taxonomy: `value` may be anything an
 * executor — third-party code at runtime even when it's typed at compile
 * time — chooses to hand back, including a forged string an untrusted
 * executor supplied, a prototype-pollution attempt (`'__proto__'`,
 * `'constructor'`), a stale/renamed kind from an older version of some
 * executor, `undefined`, a number, or an object. ANYTHING not exactly one of
 * `FAILURE_KINDS` normalizes to `'script-error'` — the safest default, since
 * an unrecognized failure is treated as "the script did something wrong",
 * never silently upgraded to a more privileged-sounding category like
 * `'tier-blocked'` or `'capability-denied'`.
 *
 * Never throws.
 */
export function normalizeFailureKind(value: unknown): FailureKind {
  return typeof value === 'string' &&
    (FAILURE_KINDS as readonly string[]).includes(value)
    ? (value as FailureKind)
    : 'script-error';
}

/**
 * The per-script progress message (GitHub issue #35): its shape and its
 * hostile-shape guard, and nothing else.
 *
 * WHY IT IS ITS OWN MODULE. The message is BUILT inside the isolate
 * (`./run-job.ts`, so both worker entries emit an identical one) and READ
 * on the host (`./run-host.ts`, which tells progress from the run's single
 * result message). `./run-job.ts` imports `@markii/lua`, and that import
 * pulls a whole WebAssembly Lua engine in behind it — a host bundle must
 * never carry one, least of all the Obsidian plugin's, which runs in an
 * Electron renderer and delegates every Lua execution to a Web Worker. So
 * the protocol lives apart from the code that speaks it, exactly as
 * `./net-bridge.ts` does for the net bridge.
 *
 * Nothing here imports anything but a type.
 */
import type { StoredValue } from '@markii/runtime';

/**
 * Worker -> host, one per script, sent the moment that script's value was
 * written to the run's store and always BEFORE the single `RunResult`
 * message that settles the run. Scripts run sequentially in one isolate,
 * so the last script's value can be many seconds younger than the first's;
 * without this the preview shows every value as stale until the whole
 * batch is done.
 *
 * `index` is this message's ordinal within the run, counted from 0 in
 * document order. The host uses it to drop a duplicate or out-of-order
 * message rather than trusting arrival order alone — the channel preserves
 * order, but the isolate runs untrusted script content, so nothing coming
 * out of it is taken on trust.
 *
 * Every field is structured-clone-safe, exactly like `RunResult`: `value`
 * is the same already-marshaled `StoredValue` that ends up in
 * `RunResult.values`.
 */
export interface RunProgress {
  kind: 'markii:run-progress';
  index: number;
  name: string;
  value: StoredValue;
}

/**
 * Hostile-shape guard for a `RunProgress` message, applied by
 * `./run-host.ts` to every message an isolate sends. The isolate runs
 * untrusted script content, so a message claiming to be progress is
 * validated the same way `./run-job.ts`'s `isRunJob` validates a job:
 * every field checked, own properties only, no coercion, and `value`
 * reduced to a plain object carrying one of `@markii/runtime`'s four
 * closed statuses.
 *
 * A message that fails this is NOT progress — the caller then treats it as
 * the run's final result, where `RunResult`'s own consumers already handle
 * a malformed shape.
 */
export function isRunProgress(value: unknown): value is RunProgress {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  // Own properties only, the same discipline `apps/vscode/src/protocol.ts`
  // applies to every wire message: an object that merely INHERITS `kind`
  // from its prototype is not a progress message.
  const own = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(message, key);
  if (!own('kind') || message.kind !== 'markii:run-progress') return false;
  if (!own('index') || !own('name') || !own('value')) return false;
  if (
    typeof message.index !== 'number' ||
    !Number.isInteger(message.index) ||
    message.index < 0
  ) {
    return false;
  }
  if (typeof message.name !== 'string') return false;
  const stored = message.value;
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return false;
  }
  const status = (stored as Record<string, unknown>).status;
  return (
    status === 'fresh' ||
    status === 'stale' ||
    status === 'error' ||
    status === 'missing'
  );
}

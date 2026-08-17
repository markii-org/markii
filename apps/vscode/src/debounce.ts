/**
 * Trailing-edge debounce, used by `preview-panel.ts` to collapse a burst of
 * `onDidChangeTextDocument` events (one per keystroke) into a single
 * `update` message per idle gap, matching the playground's own
 * `DEBOUNCE_MS` pattern (`apps/playground/src/App.tsx`).
 */

/**
 * The two timer primitives this module needs, injectable so tests can
 * supply `vi.useFakeTimers()`-backed (or fully synthetic) timers without
 * this module reaching into `globalThis` directly.
 *
 * The id type is pinned to `number` on purpose (matching the DOM lib's
 * `setTimeout`/`clearTimeout` signatures) even though this file's
 * `tsconfig.json` also pulls in `@types/node`, whose ambient `setTimeout`
 * instead returns `NodeJS.Timeout` — see `createGlobalTimerApi` below for
 * how the default implementation reconciles the two without a cast.
 */
export interface TimerApi {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/**
 * Default `TimerApi`, backed by `globalThis`'s ambient timer functions.
 * Because `@types/node` and the DOM lib disagree on `setTimeout`'s return
 * type (`NodeJS.Timeout` vs `number`), that return value cannot be trusted
 * structurally as a `number` without a cast — so this adapter never treats
 * it as one. Instead it mints its OWN incrementing numeric id for every
 * scheduled timer and keeps the real (opaque, whatever-typed) underlying
 * handle in a side table keyed by that id. `TimerApi`'s contract (`number`
 * in, `number` out) is satisfied entirely by code this module owns, not by
 * trusting `globalThis`'s declared return type.
 */
function createGlobalTimerApi(): TimerApi {
  let nextId = 1;
  const handles = new Map<number, ReturnType<typeof globalThis.setTimeout>>();
  return {
    setTimeout(handler, ms) {
      const id = nextId++;
      handles.set(id, globalThis.setTimeout(handler, ms));
      return id;
    },
    clearTimeout(id) {
      const handle = handles.get(id);
      if (handle !== undefined) {
        globalThis.clearTimeout(handle);
        handles.delete(id);
      }
    },
  };
}

export interface Debouncer<T> {
  /** Schedules `run(value)` after the delay, cancelling any pending call and collapsing to this (the LAST) value. */
  schedule(value: T): void;
  /** Drops any pending call without running it. Safe to call with nothing pending. */
  cancel(): void;
}

/**
 * Builds a trailing-edge debouncer: rapid `schedule` calls within `delayMs`
 * of each other collapse into a single `run` call carrying only the most
 * recent value, `delayMs` after the LAST `schedule` call. `cancel` drops a
 * pending call outright. A `schedule` call after a previous call has
 * already fired starts a fresh, independent delay window.
 */
export function createDebouncer<T>(
  delayMs: number,
  run: (value: T) => void,
  timers: TimerApi = createGlobalTimerApi(),
): Debouncer<T> {
  let pendingId: number | undefined;

  return {
    schedule(value: T): void {
      if (pendingId !== undefined) {
        timers.clearTimeout(pendingId);
      }
      pendingId = timers.setTimeout(() => {
        pendingId = undefined;
        run(value);
      }, delayMs);
    },
    cancel(): void {
      if (pendingId !== undefined) {
        timers.clearTimeout(pendingId);
        pendingId = undefined;
      }
    },
  };
}

/**
 * ITEM 3 (AGENTS.md "clean is not silent"): a `'scheduled'`/`'auto'` run
 * that produces identical values is otherwise indistinguishable from one
 * that never happened — no value changed, so nothing in the rendered note
 * moves. This module records the last run's OUTCOME (when it ran, whether
 * it succeeded, and why not if it failed) per document, independent of
 * whatever values it produced, and reads it back for `preview-panel.ts`'s
 * `postUpdate` to surface as a quiet marker — the same "last-known state,
 * persisted, rehydrated on reopen" design `./stale-values.ts` and
 * `./run-flow.ts`'s value persistence already use.
 *
 * `vscode`-free: takes a `GrantMemento`-shaped store (the same minimal
 * `get`/`update` interface `./grant-flow.ts` already defines, which a real
 * `vscode.Memento` and a plain in-memory fake both satisfy), so this stays
 * plain TypeScript vitest can run directly.
 */
import type { RunTrigger } from '@markii/runtime';
import type { GrantMemento, Thenable } from './grant-flow.js';

/**
 * One run's recorded outcome. `reason` is present only when `ok` is
 * `false`, and is a short, human phrase (never a raw stack or the full
 * caught error) — the same "quiet marker + tooltip, never an error dump"
 * posture every other failure surface in this codebase follows.
 */
export interface RunTrace {
  readonly trigger: RunTrigger;
  /** Epoch milliseconds this run completed (or failed) at. */
  readonly ranAt: number;
  readonly ok: boolean;
  readonly reason?: string;
}

/** The `workspaceState`/Memento key a document's last-run trace lives under, mirroring `./run-flow.ts`'s `valuesStorageKeyFor`/`cacheStorageKeyFor` naming. */
export function lastRunStorageKeyFor(documentKey: string): string {
  return `markii.lastRun:${documentKey}`;
}

function isValidTrigger(value: unknown): value is RunTrigger {
  return value === 'manual' || value === 'auto' || value === 'scheduled';
}

/**
 * A plausible `RunTrace` shape read back from storage — never trusted
 * further than this, matching `./run-flow.ts`'s `isStoredValueRecord`'s own
 * fail-safe posture: a corrupt or foreign persisted value degrades to "no
 * trace", not a thrown error.
 */
export function isRunTrace(value: unknown): value is RunTrace {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isValidTrigger(v.trigger)) return false;
  if (typeof v.ranAt !== 'number' || !Number.isFinite(v.ranAt)) return false;
  if (typeof v.ok !== 'boolean') return false;
  if (v.reason !== undefined && typeof v.reason !== 'string') return false;
  return true;
}

/** Reads a document's persisted last-run trace, or `undefined` when there is none / it is unusable. Never throws. */
export function readLastRunTrace(
  memento: GrantMemento,
  documentKey: string,
): RunTrace | undefined {
  const raw = memento.get<unknown>(lastRunStorageKeyFor(documentKey));
  return isRunTrace(raw) ? raw : undefined;
}

/** Persists `trace` as `documentKey`'s last-run outcome, superseding whatever was there before. */
export function writeLastRunTrace(
  memento: GrantMemento,
  documentKey: string,
  trace: RunTrace,
): Thenable<void> {
  return memento.update(lastRunStorageKeyFor(documentKey), trace);
}

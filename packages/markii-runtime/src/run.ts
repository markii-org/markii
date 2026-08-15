import type { ScriptBlock } from '@markii/core';
import type { StoredValue, ValueStore } from './store';

/**
 * Slice 2 of the scripting-usability layer (DESIGN.md §8): the run
 * orchestrator that executes a document's script blocks and writes their
 * results into the `ValueStore` Slice 1 built. This module never imports a
 * concrete language runtime (no `@markii/lua`, no wasmoon) — it only knows
 * about the `ScriptExecutor` shape below, which a language-specific package
 * adapts to (see `@markii/lua`'s `createLuaExecutor`). That keeps the run
 * path pluggable: any future script language plugs into the same
 * `runDocumentScripts` without this package ever changing.
 */

/**
 * How a batch of scripts was invoked — DESIGN.md §8's three triggers:
 * - `'manual'`    — an explicit run/run-all click.
 * - `'auto'`      — opt-in run-on-open.
 * - `'scheduled'` — opt-in periodic run.
 */
export type RunTrigger = 'manual' | 'auto' | 'scheduled';

/**
 * DESIGN.md §8's two-tier capability gate a concrete script executor (e.g.
 * `@markii/lua`'s `runScript`) enforces: `'manual'` unlocks every manifest
 * grant, including effectful ops; `'auto'` is read-only regardless of what
 * was granted.
 */
export type ExecutionTier = 'manual' | 'auto';

/**
 * DESIGN.md §8's trigger x capability table, expressed as a pure lookup —
 * THIS IS THE SECURITY GATE for the whole run path. `'manual'` is the only
 * trigger that can ever produce the full-grants `'manual'` tier; `'auto'`
 * and `'scheduled'` both map to the read-only `'auto'` tier, unconditionally.
 * Typing this as `Record<RunTrigger, ExecutionTier>` means the mapping is
 * exhaustive by construction — a future `RunTrigger` member is a compile
 * error here until it's given an explicit (and reviewable) tier, rather
 * than silently falling through to some default. See `run.test.ts` for
 * exhaustive coverage of the property that `'auto'`/`'scheduled'` can never
 * yield `'manual'`.
 */
const TIER_BY_TRIGGER: Record<RunTrigger, ExecutionTier> = {
  manual: 'manual',
  auto: 'auto',
  scheduled: 'auto',
};

/** Maps a `RunTrigger` to the `ExecutionTier` it is allowed to run at. Pure, total, exported for direct unit testing — see `TIER_BY_TRIGGER`'s doc comment for why this is the security gate. */
export function tierForTrigger(trigger: RunTrigger): ExecutionTier {
  return TIER_BY_TRIGGER[trigger];
}

/** A successful script execution: the (unmarshaled) return value. */
export interface ExecuteSuccess {
  ok: true;
  value: unknown;
}

/**
 * A failed script execution. `kind` is intentionally a plain `string`
 * (not a fixed union) here — `@markii/runtime` stays language-agnostic and
 * does not know the specific failure taxonomy of any one language runtime
 * (e.g. `@markii/lua`'s `'limit' | 'capability' | 'marshal' | 'runtime'`).
 * `runDocumentScripts` only ever special-cases the literal string
 * `'capability'`, by convention every executor is expected to use for a
 * denied-capability failure.
 */
export interface ExecuteFailure {
  ok: false;
  error: { kind: string; message: string };
}

export type ExecuteResult = ExecuteSuccess | ExecuteFailure;

/**
 * The runtime-owned execution primitive: given a script's resolved code and
 * the tier it's allowed to run at, execute it and report the outcome.
 * Providers/grants (net hosts, cache, bundle access, resource limits, ...)
 * are NOT parameters here — a concrete executor (e.g. `@markii/lua`'s
 * `createLuaExecutor`) closes over them at construction time, so this
 * package never depends on any specific language runtime or capability
 * shape.
 */
export type ScriptExecutor = (input: {
  code: string;
  tier: ExecutionTier;
}) => Promise<ExecuteResult>;

/** One script's outcome from a `runDocumentScripts` batch, in document order. */
export interface RunSummaryEntry {
  name: string;
  status: 'fresh' | 'error';
  error?: string;
}

/**
 * The result of one `runDocumentScripts` call. `results` has one entry per
 * script block actually run, in document order — including every
 * duplicate-named attempt, not deduplicated. When `scripts` contained
 * repeated `name`s, `duplicateNames` lists which ones; per DESIGN.md §8
 * ("`name`s land in one note-scoped value store regardless of position"),
 * the store ends up holding whatever the LAST run for that name produced
 * (document order) — `results` still records every individual attempt.
 */
export interface RunSummary {
  trigger: RunTrigger;
  tier: ExecutionTier;
  results: RunSummaryEntry[];
  freshCount: number;
  errorCount: number;
  duplicateNames: string[];
}

export interface RunDocumentScriptsOptions {
  scripts: ScriptBlock[];
  executor: ScriptExecutor;
  trigger: RunTrigger;
  store: ValueStore;
  /**
   * Resolves a `src=` long-script reference (DESIGN.md §8) to its Lua
   * source text. Optional: a document with only inline script blocks never
   * needs it. If a block has `src` set and this is not provided, that one
   * block is recorded as an error (never a thrown exception).
   */
  loadSource?: (src: string) => Promise<string> | string;
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * §8: "An effectful call under an auto trigger fails cleanly; the
 * consuming component shows a 'requires manual run' marker." When the tier
 * a script ran at was the read-only `'auto'` tier and the executor reports
 * a `'capability'`-kind failure, the stored error message is rewritten to
 * clearly say so, so a component (or a human reading the value store) does
 * not have to re-derive "this needs a manual run" from a generic capability
 * message.
 */
function messageForFailure(
  tier: ExecutionTier,
  error: ExecuteFailure['error'],
): string {
  if (tier === 'auto' && error.kind === 'capability') {
    return `${error.message} (requires manual run: this capability is only available on a manual run)`;
  }
  return error.message;
}

interface RunOneOutcome {
  entry: RunSummaryEntry;
  storedValue: StoredValue;
}

/**
 * Runs exactly one script block and never throws: every way it can fail
 * (missing `loadSource` for a `src=` reference, `loadSource` itself
 * throwing, the executor rejecting/throwing, or the executor reporting
 * `ok: false`) is caught here and turned into an `error`-status outcome, so
 * one bad script can never abort the rest of a `runDocumentScripts` batch.
 */
async function runOne(
  script: ScriptBlock,
  executor: ScriptExecutor,
  tier: ExecutionTier,
  loadSource: RunDocumentScriptsOptions['loadSource'],
): Promise<RunOneOutcome> {
  let code: string;
  try {
    if (script.src !== undefined) {
      if (!loadSource) {
        throw new Error(
          `script "${script.name}" references src "${script.src}" but no loadSource was provided`,
        );
      }
      code = await loadSource(script.src);
    } else {
      code = script.code;
    }
  } catch (err) {
    const message = describeThrown(err);
    const ranAt = Date.now();
    return {
      entry: { name: script.name, status: 'error', error: message },
      storedValue: { value: undefined, status: 'error', error: message, ranAt },
    };
  }

  let result: ExecuteResult;
  try {
    result = await executor({ code, tier });
  } catch (err) {
    const message = describeThrown(err);
    const ranAt = Date.now();
    return {
      entry: { name: script.name, status: 'error', error: message },
      storedValue: { value: undefined, status: 'error', error: message, ranAt },
    };
  }

  const ranAt = Date.now();
  if (result.ok) {
    return {
      entry: { name: script.name, status: 'fresh' },
      storedValue: { value: result.value, status: 'fresh', ranAt },
    };
  }

  const message = messageForFailure(tier, result.error);
  return {
    entry: { name: script.name, status: 'error', error: message },
    storedValue: { value: undefined, status: 'error', error: message, ranAt },
  };
}

/**
 * Runs every script block in `scripts`, in document order, against
 * `executor`, and writes each outcome into `store`. This is the RUN PATH:
 * "Rendering is pure; running is an event" (DESIGN.md §8) — this function
 * is the event. It never throws; a single script failing (bad `src`,
 * `loadSource` throwing, the executor rejecting/throwing, or an ordinary
 * `ok: false` result) is recorded as that one script's error status and the
 * batch continues.
 *
 * `trigger` is mapped to an `ExecutionTier` via `tierForTrigger` exactly
 * once, up front, and that same tier is used for every script in the
 * batch — the security gate is applied per batch-invocation, not
 * per-script, matching DESIGN.md §8 (a run is manual, auto, or scheduled as
 * a whole; individual scripts don't choose their own tier).
 *
 * Duplicate `name`s: every attempt gets its own `RunSummary.results` entry,
 * but `store.set` is called once per script in document order, so the LAST
 * run for a given name is what's left in the store afterward — see
 * `RunSummary.duplicateNames`.
 */
export async function runDocumentScripts(
  options: RunDocumentScriptsOptions,
): Promise<RunSummary> {
  const { scripts, executor, trigger, store, loadSource } = options;
  const tier = tierForTrigger(trigger);

  const results: RunSummaryEntry[] = [];
  const seenNames = new Set<string>();
  const duplicateNames = new Set<string>();

  for (const script of scripts) {
    if (seenNames.has(script.name)) {
      duplicateNames.add(script.name);
    }
    seenNames.add(script.name);

    const outcome = await runOne(script, executor, tier, loadSource);
    results.push(outcome.entry);
    store.set(script.name, outcome.storedValue);
  }

  let freshCount = 0;
  let errorCount = 0;
  for (const entry of results) {
    if (entry.status === 'fresh') freshCount++;
    else errorCount++;
  }

  return {
    trigger,
    tier,
    results,
    freshCount,
    errorCount,
    duplicateNames: [...duplicateNames],
  };
}

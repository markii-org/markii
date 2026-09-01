import type { ScriptBlock } from '@markii/core';
import {
  createDocViewSource,
  EMPTY_DIRECTIVE_LISTING,
  type DocumentContext,
  type DocView,
} from './doc.js';
import { normalizeFailureKind, type FailureKind } from './failure.js';
import type { StoredValue, ValueStore } from './store.js';
import type { VaultWriter } from './vault.js';

/**
 * Slice 2 of the scripting-usability layer (docs/scripting.md): the run
 * orchestrator that executes a document's script blocks and writes their
 * results into the `ValueStore` Slice 1 built. This module never imports a
 * concrete language runtime (no `@markii/lua`, no wasmoon) — it only knows
 * about the `ScriptExecutor` shape below, which a language-specific package
 * adapts to (see `@markii/lua`'s `createLuaExecutor`). That keeps the run
 * path pluggable: any future script language plugs into the same
 * `runDocumentScripts` without this package ever changing.
 */

/**
 * How a batch of scripts was invoked — docs/scripting.md's three triggers:
 * - `'manual'`    — an explicit run/run-all click.
 * - `'auto'`      — opt-in run-on-open.
 * - `'scheduled'` — opt-in periodic run.
 */
export type RunTrigger = 'manual' | 'auto' | 'scheduled';

/**
 * docs/scripting.md's two-tier capability gate a concrete script executor (e.g.
 * `@markii/lua`'s `runScript`) enforces: `'manual'` unlocks every manifest
 * grant, including effectful ops; `'auto'` is read-only regardless of what
 * was granted.
 */
export type ExecutionTier = 'manual' | 'auto';

/**
 * docs/scripting.md's trigger x capability table, expressed as a pure lookup —
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
 * A failed script execution. `kind` is the CLOSED `FailureKind` union
 * (`./failure.ts`) — every concrete `ScriptExecutor` (e.g. `@markii/lua`'s
 * `createLuaExecutor`) is expected to map its own language-specific failure
 * shape (e.g. Lua's `'limit' | 'capability' | 'marshal' | 'runtime'`) down
 * to this shared vocabulary before returning. Even though this is typed as
 * `FailureKind` at compile time, an executor is untrusted third-party code
 * at RUNTIME (a forged string, a stale value from an older executor
 * version, ...) — `runDocumentScripts` therefore runs every incoming
 * `kind` through `normalizeFailureKind` at the boundary regardless of what
 * the type system already promises, so a hostile or buggy executor can
 * never produce a `StoredValue`/`RunSummaryEntry` carrying an
 * out-of-taxonomy `failureKind`.
 */
export interface ExecuteFailure {
  ok: false;
  error: { kind: FailureKind; message: string };
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
  /**
   * This script's read-only view of the note it lives in (`./doc.ts`,
   * GitHub issue #33): the note's directives as plain data, and a read of
   * what the scripts ABOVE this one already produced. Optional so an
   * executor written before this existed still satisfies the type; every
   * executor that does expose it must expose it as read-only data and must
   * turn a rejected `value()` read into an ordinary failed execution.
   *
   * It carries no authority and is therefore NOT tier-gated: the same view
   * is handed to a script under `'auto'` as under `'manual'`, because
   * everything in it is the note's own content and this run's own values.
   */
  doc?: DocView;
}) => Promise<ExecuteResult>;

/** One script's outcome from a `runDocumentScripts` batch, in document order. */
export interface RunSummaryEntry {
  name: string;
  status: 'fresh' | 'error';
  error?: string;
  /**
   * Set alongside `error` on every `status: 'error'` entry — the closed
   * `FailureKind` (`./failure.ts`) this failure was classified as. Already
   * normalized (see `ExecuteFailure`'s doc comment), so a caller can branch
   * on it directly without re-deriving trust. Absent for a `'fresh'` entry.
   */
  failureKind?: FailureKind;
  /**
   * Publish outcome (docs/scripting.md's vault). Set ONLY for a script block
   * whose fence carried the bare `publish` attribute (`ScriptBlock.publish
   * === true`) AND whose run succeeded (`status === 'fresh'`) — a
   * non-publish block never gets this field, and a publish-flagged block
   * whose run FAILED never gets it either (its `status` already says
   * `'error'`; there is nothing to publish).
   * - `'published'`    — `vault.publish` accepted the value.
   * - `'rejected'`     — a writer was present but declined (see
   *   `publishError`); the note's own `status` STAYS `'fresh'` regardless —
   *   a vault rejection is not a script failure.
   * - `'not-granted'`  — no `vault` was supplied to `runDocumentScripts` at
   *   all; publishing was flagged but no grant existed to act on it.
   */
  publish?: 'published' | 'rejected' | 'not-granted';
  /** Set only when `publish === 'rejected'`; the writer's rejection message. */
  publishError?: string;
}

/**
 * The result of one `runDocumentScripts` call. `results` has one entry per
 * script block actually run, in document order — including every
 * duplicate-named attempt, not deduplicated. When `scripts` contained
 * repeated `name`s, `duplicateNames` lists which ones; per docs/scripting.md
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
  /** Count of `results` entries with `publish === 'published'`. */
  publishedCount: number;
}

export interface RunDocumentScriptsOptions {
  scripts: ScriptBlock[];
  executor: ScriptExecutor;
  trigger: RunTrigger;
  store: ValueStore;
  /**
   * Resolves a `src=` long-script reference (docs/scripting.md) to its Lua
   * source text. Optional: a document with only inline script blocks never
   * needs it. If a block has `src` set and this is not provided, that one
   * block is recorded as an error (never a thrown exception).
   */
  loadSource?: (src: string) => Promise<string> | string;
  /**
   * The publish grant (docs/scripting.md: "Publishing requires a grant ...
   * because it writes beyond the note"). ITS PRESENCE IS THE GRANT — there
   * is no separate flag to enable publishing, and no per-script grant
   * check; a host that hands in a `vault` is thereby authorizing every
   * `publish`-flagged block in this batch to write to it. Absent =>
   * publish-flagged blocks simply do not publish (`publish: 'not-granted'`
   * on their `RunSummaryEntry`); this is NOT an error and the run still
   * succeeds.
   *
   * Publishing is allowed under BOTH execution tiers (`'manual'` and
   * `'auto'`) whenever a writer is present — the grant is the gate here,
   * NOT the trigger/tier. This is deliberately orthogonal to
   * `tierForTrigger`'s security gate: that gate governs what CAPABILITIES a
   * script may exercise while running (network access, cache writes, ...)
   * via the tier passed to the executor; it says nothing about whether the
   * host is willing to copy an already-computed, already-successful return
   * value into its own vault afterward. A read-only `'auto'`-tier run can
   * still publish, because publishing isn't a capability the SCRIPT
   * exercises — it's something the HOST does with a value the script already
   * (successfully) produced.
   */
  vault?: VaultWriter;
  /**
   * Called once per script, immediately after its `StoredValue` was written
   * to `store` and in the same document order the scripts ran in (GitHub
   * issue #35). This is the hook a host uses to show a value the moment it
   * lands rather than at the end of the batch: `runDocumentScripts` runs
   * scripts sequentially, so by the time the batch resolves, the first
   * script's number has often been known for seconds.
   *
   * Purely observational. It cannot change what is stored, what is
   * reported, or whether the batch continues: `entry` is a SHALLOW COPY of
   * the summary entry (so a callback cannot mutate the run's own
   * bookkeeping, and so it never later grows the publish fields, which are
   * decided after this point), and anything this callback throws is
   * swallowed — `runDocumentScripts` never throws, and a host's progress
   * reporting failing must not cost the user the rest of the run.
   *
   * Called for a FAILED script too, with the error `StoredValue` that was
   * stored for it: a failure is as much a result as a number, and a host
   * that only heard about successes would leave that script's component
   * looking like it was still running.
   */
  onValue?: (name: string, value: StoredValue, entry: RunSummaryEntry) => void;
  /**
   * The note itself, for the `doc` view a script sees (`./doc.ts`). The
   * caller builds this once from the tree it already parsed to find
   * `scripts`; this package parses nothing.
   *
   * Absent, scripts still get a `doc` view, with an empty listing — the
   * ORDERING rules `doc.value` enforces do not depend on it, so a host
   * that never builds a listing still cannot let one script read another
   * that has not run.
   */
  doc?: DocumentContext;
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
 *
 * Failure classification (`failureKind`): the three failure paths this
 * function owns OUTRIGHT — a `src=` block with no `loadSource` configured,
 * `loadSource` itself throwing/rejecting, and the executor throwing or its
 * returned promise rejecting (as opposed to resolving with `ok: false`) —
 * are all classified as `'script-error'`. None of these are the executor
 * reporting a considered, typed failure; they are this package's OWN
 * plumbing failing (a missing host wire-up, or the executor misbehaving by
 * throwing instead of returning `ExecuteResult`), so there is no more
 * specific taxonomy member that legitimately applies — `'script-error'` is
 * both correct (something about running the script went wrong) and the safe
 * default (never guesses a more privileged-sounding kind like
 * `'capability-denied'` or `'tier-blocked'` for a failure this package can't
 * actually attribute to a capability decision). Only the fourth path —
 * `result.ok === false` from a normally-returning executor — carries a
 * `kind` the executor itself chose, and even that is passed through
 * `normalizeFailureKind` before being trusted (see `ExecuteFailure`'s doc
 * comment): the executor is untrusted third-party code at runtime.
 *
 * Stored/reported messages are the executor's `error.message` VERBATIM —
 * this function never rewrites or appends to it (see `ExecuteFailure`'s doc
 * comment; the previous `messageForFailure` auto-tier rewrite is gone: a
 * `'tier-blocked'` failure's own message already says what happened, and a
 * `'capability-denied'` failure is not a "needs manual run" situation at
 * all, so rewriting every capability-kind auto-tier failure that way was
 * simply wrong).
 */
async function runOne(
  script: ScriptBlock,
  executor: ScriptExecutor,
  tier: ExecutionTier,
  loadSource: RunDocumentScriptsOptions['loadSource'],
  doc: DocView,
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
      entry: {
        name: script.name,
        status: 'error',
        error: message,
        failureKind: 'script-error',
      },
      storedValue: {
        value: undefined,
        status: 'error',
        error: message,
        failureKind: 'script-error',
        ranAt,
      },
    };
  }

  let result: ExecuteResult;
  try {
    result = await executor({ code, tier, doc });
  } catch (err) {
    const message = describeThrown(err);
    const ranAt = Date.now();
    return {
      entry: {
        name: script.name,
        status: 'error',
        error: message,
        failureKind: 'script-error',
      },
      storedValue: {
        value: undefined,
        status: 'error',
        error: message,
        failureKind: 'script-error',
        ranAt,
      },
    };
  }

  const ranAt = Date.now();
  if (result.ok) {
    return {
      entry: { name: script.name, status: 'fresh' },
      storedValue: { value: result.value, status: 'fresh', ranAt },
    };
  }

  const failureKind = normalizeFailureKind(result.error.kind);
  const message = result.error.message;
  return {
    entry: { name: script.name, status: 'error', error: message, failureKind },
    storedValue: {
      value: undefined,
      status: 'error',
      error: message,
      failureKind,
      ranAt,
    },
  };
}

/**
 * Runs every script block in `scripts`, in document order, against
 * `executor`, and writes each outcome into `store`. This is the RUN PATH:
 * "Rendering is pure; running is an event" (docs/scripting.md) — this function
 * is the event. It never throws; a single script failing (bad `src`,
 * `loadSource` throwing, the executor rejecting/throwing, or an ordinary
 * `ok: false` result) is recorded as that one script's error status and the
 * batch continues.
 *
 * `trigger` is mapped to an `ExecutionTier` via `tierForTrigger` exactly
 * once, up front, and that same tier is used for every script in the
 * batch — the security gate is applied per batch-invocation, not
 * per-script, matching docs/scripting.md (a run is manual, auto, or scheduled as
 * a whole; individual scripts don't choose their own tier).
 *
 * Publishing (§8's vault): after a `publish`-flagged block's run SUCCEEDS,
 * if `options.vault` was supplied its `publish` is called with the same
 * `StoredValue` just written to `store` — see `RunDocumentScriptsOptions.
 * vault`'s doc comment for why the grant, not the trigger/tier, is what
 * gates this. A writer that rejects, throws, or has its promise reject
 * never aborts the batch and never changes the note's own `status` (which
 * stays `'fresh'`) — only `RunSummaryEntry.publish`/`.publishError` record
 * the outcome. This function still never throws.
 *
 * Duplicate `name`s: every attempt gets its own `RunSummary.results` entry,
 * but `store.set` is called once per script in document order, so the LAST
 * run for a given name is what's left in the store afterward — see
 * `RunSummary.duplicateNames`.
 */
export async function runDocumentScripts(
  options: RunDocumentScriptsOptions,
): Promise<RunSummary> {
  const { scripts, executor, trigger, store, loadSource, vault, onValue } =
    options;
  const tier = tierForTrigger(trigger);

  // GitHub issue #33: one source of `doc` views for the whole batch. Built
  // unconditionally, even with no `options.doc`, because it also owns the
  // "a script may only read what ran above it" rule, which is a property
  // of this loop's ordering rather than of the listing.
  const docViews = createDocViewSource({
    directives: options.doc?.directives ?? EMPTY_DIRECTIVE_LISTING,
    scriptNames: scripts.map((script) => script.name),
  });

  const results: RunSummaryEntry[] = [];
  const seenNames = new Set<string>();
  const duplicateNames = new Set<string>();

  for (const [index, script] of scripts.entries()) {
    if (seenNames.has(script.name)) {
      duplicateNames.add(script.name);
    }
    seenNames.add(script.name);

    const outcome = await runOne(
      script,
      executor,
      tier,
      loadSource,
      docViews.viewFor(index),
    );
    store.set(script.name, outcome.storedValue);
    // GitHub issue #35: the value is announced the instant it is stored,
    // before publishing and before the batch moves on to the next script,
    // so a host can render it while the rest of the run is still going.
    // Guarded because this function's never-throws contract covers
    // everything a caller supplies, this callback included.
    if (onValue) {
      try {
        onValue(script.name, outcome.storedValue, { ...outcome.entry });
      } catch {
        // Deliberately ignored: see `onValue`'s doc comment.
      }
    }
    // Recorded AFTER the run, so a script can never see its own name, and
    // recorded for a failed run too (as `undefined`), so a later reader
    // gets nil rather than a refusal blaming it for someone else's error.
    docViews.recordCompleted(script.name, outcome.storedValue.value);

    // Publishing (docs/scripting.md): only for a block that both asked to
    // publish (bare `publish` on its fence — see `ScriptBlock.publish`) and
    // actually succeeded. A failed run has nothing to publish; `runOne`
    // already recorded its failure in `outcome.entry.status`/`.error`, and
    // `publish` is left `undefined` on that entry (per `RunSummaryEntry`'s
    // doc comment) rather than getting a misleading 'not-granted'/'rejected'.
    if (script.publish === true && outcome.entry.status === 'fresh') {
      if (!vault) {
        outcome.entry.publish = 'not-granted';
      } else {
        let result: Awaited<ReturnType<VaultWriter['publish']>>;
        try {
          result = await vault.publish(script.name, outcome.storedValue);
        } catch (err) {
          result = {
            ok: false,
            error: { kind: 'error', message: describeThrown(err) },
          };
        }
        if (result.ok) {
          outcome.entry.publish = 'published';
        } else {
          outcome.entry.publish = 'rejected';
          outcome.entry.publishError = result.error.message;
        }
      }
    }

    results.push(outcome.entry);
  }

  let freshCount = 0;
  let errorCount = 0;
  let publishedCount = 0;
  for (const entry of results) {
    if (entry.status === 'fresh') freshCount++;
    else errorCount++;
    if (entry.publish === 'published') publishedCount++;
  }

  return {
    trigger,
    tier,
    results,
    freshCount,
    errorCount,
    duplicateNames: [...duplicateNames],
    publishedCount,
  };
}

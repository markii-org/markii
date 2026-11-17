import type * as ReactNamespace from 'react';

/**
 * The in-page half of the pack registration convention (docs/packs.md): a
 * pack's prebuilt `webview.js` is a classic script that calls
 * `window.__markiiRegisterPack(manifestJson, componentModules)` while it
 * loads and reads React lazily from `window.__markiiReact` when a component
 * renders. `evaluatePackScripts` runs a list of such scripts and returns the
 * registrations they made, for a host to hand to `@markii/host`'s
 * `buildRenderRegistry`. `readPackRegistrationQueue` is the second half on
 * its own, for a host whose page loads the scripts itself.
 *
 * The functions here run pack code with the page's privileges. See
 * `evaluatePackScripts` for what the page's Content-Security-Policy must
 * allow.
 */

/** One pack script to run: `namespace` labels a failure, `source` is the script text. */
export interface PackScriptSource {
  readonly namespace: string;
  readonly source: string;
}

/**
 * One registration a pack script made. Structurally identical to
 * `@markii/host`'s `QueuedPackRegistration`, which this package cannot
 * import, so the result is assignable to `buildRenderRegistry`'s input.
 */
export interface PackScriptRegistration {
  readonly manifestJson: unknown;
  readonly componentModules: unknown;
}

/** A script that threw while it ran, with the thrown message. */
export interface PackScriptFailure {
  readonly namespace: string;
  readonly reason: string;
}

export interface EvaluatePackScriptsResult {
  readonly registrations: PackScriptRegistration[];
  readonly failures: PackScriptFailure[];
}

export interface EvaluatePackScriptsOptions {
  /** The one React instance every pack component renders with. */
  readonly react: typeof ReactNamespace;
}

interface RawRegistration {
  manifest: unknown;
  componentModules: unknown;
}

interface PackGlobals {
  __markiiReact?: unknown;
  __markiiPackRegistrations?: unknown;
  __markiiRegisterPack?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The page's global object as pack scripts see it. In a browser this is
 * `window`. Where no `window` exists (a test under Node), `globalThis`
 * stands in for it and is also published as `globalThis.window`, because a
 * compiled script names `window` explicitly.
 */
function packGlobals(): PackGlobals {
  const g = globalThis as { window?: unknown };
  if (g.window === undefined) g.window = globalThis;
  return g.window as PackGlobals;
}

/**
 * Turns a registration queue a page collected into `PackScriptRegistration`s,
 * one per raw entry and in order. An entry that is not an object becomes a
 * registration with `undefined` fields, so `buildRenderRegistry` rejects it
 * with a reason and every later `pack registration #N` index stays correct.
 * A queue that is not an array reads as empty. Never throws.
 */
export function readPackRegistrationQueue(
  queue: unknown,
): PackScriptRegistration[] {
  if (!Array.isArray(queue)) return [];
  return queue.map((raw: unknown) =>
    isPlainObject(raw)
      ? { manifestJson: raw.manifest, componentModules: raw.componentModules }
      : { manifestJson: undefined, componentModules: undefined },
  );
}

/**
 * Runs each pack script in order and returns what they registered. A script
 * that throws is reported in `failures` under its namespace and the others
 * still run. Never throws.
 *
 * What a script sees while it runs: `window.__markiiReact` is `options.react`
 * and `window.__markiiRegisterPack(manifestJson, componentModules)` queues a
 * registration. Both come from the compiled script's own contract. The
 * registration's namespace is whatever the manifest says, not the
 * `namespace` passed here, which only labels a failure. A registration the
 * manifest makes under another pack's namespace is returned as written, and
 * `buildRenderRegistry` decides what to do with the collision.
 *
 * What it leaves behind: the register callback and the queue are put back
 * to what the page had before the call. A script that keeps the callback and
 * calls it after this function returned reaches a function that does
 * nothing. `window.__markiiReact` stays set, because a pack component reads
 * it each time it renders, long after this call returns. Under Node, where
 * no `window` exists, `globalThis.window` also stays defined.
 *
 * Content-Security-Policy: each script is evaluated with the `Function`
 * constructor, so the page's `script-src` must allow `'unsafe-eval'`. A page
 * that cannot allow it (a webview with a nonce-only policy) loads the
 * scripts as `<script nonce>` elements itself and reads the queue with
 * `readPackRegistrationQueue`. No blob URL and no script element is created
 * here.
 *
 * Trust: a pack script runs in the page's own context with the page's
 * privileges. Call this only with scripts from the host's own store.
 */
export function evaluatePackScripts(
  scripts: readonly PackScriptSource[],
  options: EvaluatePackScriptsOptions,
): EvaluatePackScriptsResult {
  const target = packGlobals();
  const hadRegister = Object.prototype.hasOwnProperty.call(
    target,
    '__markiiRegisterPack',
  );
  const hadQueue = Object.prototype.hasOwnProperty.call(
    target,
    '__markiiPackRegistrations',
  );
  const previousRegister = target.__markiiRegisterPack;
  const previousQueue = target.__markiiPackRegistrations;

  const queue: RawRegistration[] = [];
  let open = true;
  target.__markiiReact = options.react;
  target.__markiiPackRegistrations = queue;
  target.__markiiRegisterPack = (
    manifest: unknown,
    componentModules: unknown,
  ): void => {
    if (open) queue.push({ manifest, componentModules });
  };

  const failures: PackScriptFailure[] = [];
  try {
    for (const script of scripts) {
      try {
        new Function(script.source)();
      } catch (error) {
        failures.push({ namespace: script.namespace, reason: reasonOf(error) });
      }
    }
  } finally {
    open = false;
    if (hadRegister) target.__markiiRegisterPack = previousRegister;
    else delete target.__markiiRegisterPack;
    if (hadQueue) target.__markiiPackRegistrations = previousQueue;
    else delete target.__markiiPackRegistrations;
  }

  return { registrations: readPackRegistrationQueue(queue), failures };
}

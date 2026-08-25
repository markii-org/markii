/**
 * Evaluates a pack's compiled registration script IN-PROCESS and collects
 * what it registers — the Obsidian-specific half of the pack-loading
 * contract documented in docs/packs.md ("The component script follows a
 * small registration convention...") and implemented by
 * `@markii/host`'s `packs/pack-build.ts`: a classic IIFE that calls
 * `window.__markiiRegisterPack(manifestJson, componentModules)` and reads
 * `window.__markiiReact` LAZILY (only when a component actually renders,
 * never at load time — see that file's top doc comment for why).
 *
 * `apps/vscode`'s webview satisfies this same contract by loading each
 * pack's script as its own `<script src=...>` tag under a page it fully
 * controls (see `apps/vscode/src/webview-html.ts`'s load-order doc comment
 * and `apps/vscode/src/webview/pack-registry.ts`, which reads the resulting
 * `window.__markiiPackRegistrations` queue). This plugin has no webview and
 * no CSP boundary to route around — the React tree that renders a preview
 * runs in the SAME JavaScript context as the rest of the plugin — so the
 * simplest way to satisfy the same contract is to run the compiled script
 * text directly with `new Function(...)()` against the real global
 * `window` (Obsidian's renderer process is an ordinary browser window; in
 * Vitest's `node` test environment, where no `window` exists yet,
 * `ensureWindowGlobal` below stands one up so the same code path is
 * testable — the same "defensive shim for a real gap between the
 * production and test environments" posture `@markii/host`'s
 * `pack-build.ts` already takes for `self`, see its `ensureSelfGlobal`).
 *
 * SINGLE REACT INSTANCE: `installPackRuntime` sets `window.__markiiReact`
 * to the plugin's OWN imported `react` module (the same one `view.tsx`
 * uses to build the preview's React tree) — not a fresh copy. Every pack
 * component's JSX and every `import { useX } from 'react'` it wrote
 * compiles down to reading this exact global (see `pack-build.ts`'s "The
 * lazy-React contract" section), so a pack component created via
 * `componentModules[name].component` is a perfectly ordinary React
 * function component from the SAME React runtime `createRoot` mounts with
 * in `view.tsx` — no second copy, no cross-realm element mismatch.
 */
import * as React from 'react';
import type { QueuedPackRegistration } from '@markii/host';

/** The minimal shape this module needs from the global object — a structural subset of `Window`, kept narrow so a test can supply a plain object instead of a real DOM `Window`. */
interface PackRuntimeWindow {
  __markiiReact?: unknown;
  __markiiPackRegistrations?: Array<{
    manifest: unknown;
    componentModules: unknown;
  }>;
  __markiiRegisterPack?: (
    manifestJson: unknown,
    componentModules: unknown,
  ) => void;
}

/**
 * Ensures a global `window` identifier exists for compiled pack scripts to
 * find via their own `typeof window !== 'undefined'` guard. In the real
 * Obsidian desktop renderer (an Electron browser window) `window` already
 * exists — `globalThis.window === globalThis` — so this is a no-op there.
 * In Vitest's `node` test environment there is no ambient `window`, so this
 * stands one up by assigning a plain object to `globalThis.window`: V8
 * resolves a bare `window` identifier inside `new Function(...)`-evaluated
 * code by looking it up as a property of the global object, exactly the
 * same way it resolves any other global — so a property assigned directly
 * on `globalThis` is visible to that code the same way a real DOM global
 * would be. Never throws.
 */
function ensureWindowGlobal(): PackRuntimeWindow {
  const g = globalThis as unknown as { window?: PackRuntimeWindow };
  if (typeof g.window === 'undefined') {
    g.window = {} as PackRuntimeWindow;
  }
  return g.window;
}

/**
 * Installs the runtime globals every compiled pack script's IIFE expects,
 * and resets the registration queue. Call this ONCE per pack-load pass
 * (`./pack-context.ts`'s caller, `view.tsx`), before evaluating any pack
 * script — evaluating a script that calls `window.__markiiRegisterPack`
 * before this ran would throw inside the script's own guarded
 * `typeof window.__markiiRegisterPack === 'function'` check, which simply
 * means it registers nothing (never a crash — see `pack-build.ts`'s
 * `entrySource`).
 */
export function installPackRuntime(): void {
  const w = ensureWindowGlobal();
  w.__markiiReact = React;
  w.__markiiPackRegistrations = [];
  w.__markiiRegisterPack = (manifestJson, componentModules) => {
    (w.__markiiPackRegistrations ??= []).push({
      manifest: manifestJson,
      componentModules,
    });
  };
}

/** One evaluation outcome — never throws out of `evaluatePackScript` itself; a script that throws while loading is reported this way so the caller can skip that one pack quietly (AGENTS.md's cleanliness rule) rather than let it break every other pack or the preview. */
export type PackScriptEvalResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Runs one compiled pack script's text in the global scope via the
 * `Function` constructor — deliberately not a nested closure (`new
 * Function` bodies run with only the global scope in their chain, no
 * access to this module's local variables), which is exactly what the
 * compiled IIFE expects: it only ever reaches for `window` and, inside its
 * own bundled module wrapper, its own local variables. This is the
 * in-process equivalent of the VS Code webview's `<script src=...>` tag —
 * same trust boundary (docs/security.md: "packs are user-installed,
 * trusted"), same never-throw-outward contract.
 */
export function evaluatePackScript(scriptText: string): PackScriptEvalResult {
  try {
    // The in-process equivalent of loading a pack's compiled script via a
    // <script> tag; see this function's doc comment.
    const run = new Function(scriptText);
    run();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reads and clears whatever `window.__markiiPackRegistrations` accumulated
 * since the last `installPackRuntime` call — every entry a script pushed by
 * calling `window.__markiiRegisterPack`. Never throws; a queue that was
 * never initialized (no `installPackRuntime` call, or a hostile script that
 * clobbered it with something un-array-like) reads back as empty.
 */
export function collectPackRegistrations(): QueuedPackRegistration[] {
  const w = ensureWindowGlobal();
  const queued = Array.isArray(w.__markiiPackRegistrations)
    ? w.__markiiPackRegistrations
    : [];
  w.__markiiPackRegistrations = [];
  return queued.map((entry) => ({
    manifestJson: entry.manifest,
    componentModules: entry.componentModules,
  }));
}

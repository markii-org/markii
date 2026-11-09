import * as React from 'react';
import * as Ink from 'ink';
import { usePackInput } from './interactive.js';
import { parsePackManifest } from '@markii/pack';
import type {
  AnsiPackComponentModules,
  AnsiPackToInstall,
} from './pack-loader.js';

/**
 * The terminal pack registration contract (docs/packs.md). A pack's
 * prebuilt `terminal.js` is an ESM module. On evaluation it calls
 *
 *   globalThis.__markiiRegisterTerminalPack(manifestJson, componentModules)
 *
 * with the raw `pack.json` text and an own-property map of
 * `{ component, inline?, focusable? }` keyed by local component name, the same shape
 * `__markiiRegisterPack` takes for the webview. React and Ink are NOT
 * bundled into the script. The host sets `globalThis.__markiiReactInk`
 * (the React instance Ink uses) and `globalThis.__markiiInk` (Ink's
 * exports) and a pack reads them only inside render-time functions, so
 * evaluating the script with both undefined must not throw.
 *
 * SECURITY: evaluating this script runs the pack's code in the calling
 * process with that process's full privileges. Only a host's own device-
 * local install store and bundled packs may reach `loadTerminalPackScript`:
 * never a note, a bundle, the working directory, or an environment
 * variable (docs/security.md).
 */
export const TERMINAL_REGISTER_GLOBAL = '__markiiRegisterTerminalPack';
export const TERMINAL_REACT_GLOBAL = '__markiiReactInk';
export const TERMINAL_INK_GLOBAL = '__markiiInk';

/**
 * Publishes this package's own React and Ink instances for pack scripts to
 * read at render time. Idempotent. Left in place for the life of the
 * process, since a pack reads them each time its component renders.
 */
export function installTerminalPackGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  g[TERMINAL_REACT_GLOBAL] = React;
  // Ink's exports with `useInput` replaced by the focus-gated one: a pack
  // gets keys while its component has focus and never raw stdin.
  g[TERMINAL_INK_GLOBAL] = { ...Ink, useInput: usePackInput };
}

export type LoadTerminalPackScriptResult =
  { ok: true; pack: AnsiPackToInstall } | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property validation of the registered map, same rule as the webview convention. */
function toComponentModules(
  value: unknown,
): AnsiPackComponentModules | undefined {
  if (!isPlainObject(value)) return undefined;
  const out = Object.create(null) as AnsiPackComponentModules;
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(value, key)) continue;
    const entry = value[key];
    if (!isPlainObject(entry) || typeof entry.component !== 'function') {
      return undefined;
    }
    if (Object.hasOwn(entry, 'inline') && typeof entry.inline !== 'boolean') {
      return undefined;
    }
    if (
      Object.hasOwn(entry, 'focusable') &&
      typeof entry.focusable !== 'boolean'
    ) {
      return undefined;
    }
    out[key] = {
      component:
        entry.component as AnsiPackComponentModules[string]['component'],
      ...(typeof entry.inline === 'boolean' ? { inline: entry.inline } : {}),
      ...(typeof entry.focusable === 'boolean'
        ? { focusable: entry.focusable }
        : {}),
    };
  }
  return out;
}

// Evaluations are serialized: the register hook is one process global.
let queue: Promise<unknown> = Promise.resolve();
let nonce = 0;

async function evaluate(
  scriptText: string,
): Promise<LoadTerminalPackScriptResult> {
  installTerminalPackGlobals();
  const g = globalThis as Record<string, unknown>;
  const previous = g[TERMINAL_REGISTER_GLOBAL];
  const registrations: { manifestJson: unknown; modules: unknown }[] = [];
  g[TERMINAL_REGISTER_GLOBAL] = (manifestJson: unknown, modules: unknown) => {
    registrations.push({ manifestJson, modules });
  };
  try {
    nonce += 1;
    const source = `${scriptText}\n//# markiiTerminalPack=${String(nonce)}`;
    const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
    try {
      await import(/* @vite-ignore */ url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: `terminal.js threw while loading: ${detail}`,
      };
    }
  } finally {
    if (previous === undefined) delete g[TERMINAL_REGISTER_GLOBAL];
    else g[TERMINAL_REGISTER_GLOBAL] = previous;
  }

  if (registrations.length !== 1) {
    return {
      ok: false,
      reason:
        registrations.length === 0
          ? `terminal.js did not call ${TERMINAL_REGISTER_GLOBAL}`
          : `terminal.js called ${TERMINAL_REGISTER_GLOBAL} ${String(registrations.length)} times; exactly one registration is allowed`,
    };
  }
  const { manifestJson, modules } = registrations[0]!;
  if (typeof manifestJson !== 'string') {
    return {
      ok: false,
      reason: 'terminal.js did not provide a manifest JSON string',
    };
  }
  const parsed = parsePackManifest(manifestJson);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: `terminal.js manifest is invalid (${parsed.errors.join('; ')})`,
    };
  }
  const componentModules = toComponentModules(modules);
  if (componentModules === undefined) {
    return { ok: false, reason: 'terminal.js registered malformed components' };
  }
  return { ok: true, pack: { manifest: parsed.manifest, componentModules } };
}

/**
 * Evaluates one pack's `terminal.js` text and returns the validated pack
 * ready for `installAnsiPacks`, or the reason it could not be used. Never
 * rejects. SECURITY: runs the script's code in this process; see the
 * module comment for who may call it.
 */
export function loadTerminalPackScript(
  scriptText: string,
): Promise<LoadTerminalPackScriptResult> {
  const run = queue.then(() => evaluate(scriptText));
  queue = run.catch(() => undefined);
  return run.catch((error: unknown) => ({
    ok: false as const,
    reason: `terminal.js could not be evaluated: ${error instanceof Error ? error.message : String(error)}`,
  }));
}

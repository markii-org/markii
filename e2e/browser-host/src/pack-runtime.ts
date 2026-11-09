import * as React from 'react';
import { buildRenderRegistry, type QueuedPackRegistration } from '@markii/host';
import { reactPackEngine, type Registry } from '@markii/react';

interface PackWindow {
  __markiiReact?: unknown;
  __markiiPackRegistrations?: {
    manifest: unknown;
    componentModules: unknown;
  }[];
  __markiiRegisterPack?: (manifest: unknown, modules: unknown) => void;
}

/**
 * Evaluates one prebuilt pack script (`webview.js`) in-page and folds what it
 * registered into a Registry. The documented registration contract
 * (docs/packs.md): the script calls `window.__markiiRegisterPack` and reads
 * React lazily from `window.__markiiReact`.
 */
export function registryFromPackScripts(
  scripts: readonly string[],
  base: Registry,
): { registry: Registry; reasons: string[] } {
  const w = window as unknown as PackWindow;
  w.__markiiReact = React;
  w.__markiiPackRegistrations = [];
  w.__markiiRegisterPack = (manifest, componentModules) => {
    w.__markiiPackRegistrations?.push({ manifest, componentModules });
  };
  const reasons: string[] = [];
  for (const script of scripts) {
    try {
      new Function(script)();
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  const queued: QueuedPackRegistration[] = (
    w.__markiiPackRegistrations ?? []
  ).map((entry) => ({
    manifestJson: entry.manifest,
    componentModules: entry.componentModules,
  }));
  const built = buildRenderRegistry(queued, base, reactPackEngine);
  return {
    registry: built.registry,
    reasons: [...reasons, ...built.invalidReasons],
  };
}

import * as React from 'react';
import { buildRenderRegistry } from '@markii/host';
import {
  evaluatePackScripts,
  reactPackEngine,
  type Registry,
} from '@markii/react';

/**
 * Evaluates the prebuilt pack scripts (`webview.js`) in-page and folds what
 * they registered into a Registry. The page runs them with the `Function`
 * constructor, so this fixture's page allows `'unsafe-eval'`.
 */
export function registryFromPackScripts(
  scripts: readonly string[],
  base: Registry,
): { registry: Registry; reasons: string[] } {
  const evaluated = evaluatePackScripts(
    scripts.map((source, index) => ({
      namespace: `script ${String(index + 1)}`,
      source,
    })),
    { react: React },
  );
  const built = buildRenderRegistry(
    evaluated.registrations,
    base,
    reactPackEngine,
  );
  return {
    registry: built.registry,
    reasons: [
      ...evaluated.failures.map((failure) => failure.reason),
      ...built.invalidReasons,
    ],
  };
}

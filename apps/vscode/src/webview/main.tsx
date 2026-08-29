import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Order matters: `doc.css` (the reference document stylesheet, hardcoded
// light-mode colors) loads first, then `theme.css` overrides its color
// custom properties/selectors to derive every surface from the editor's own
// VS Code theme colors — see `theme.css`'s doc comment and
// `theme-coverage.test.ts`, which guards this override sheet against
// drifting out of sync with `doc.css`.
import '@markii/react/doc.css';
import './theme.css';
import { defaultRegistry } from '@markii/react/components';
import { buildRenderRegistry } from './pack-registry.js';
import { getVsCodeApi } from './vscode-api.js';
import { Preview } from './preview.js';
import type { PackDiagnosticsMessage } from '../protocol.js';

/**
 * GitHub issue #3 slice 5 (docs/packs.md): the ONE React instance every
 * registered pack component must render through
 * (`window.__markiiReact.createElement(...)`), so a pack never bundles its
 * own React copy. Set BEFORE anything renders — every pack `<script>` tag
 * has already run by this point (`../webview-html.ts`'s fixed load order:
 * pack scripts before this bundle), but a pack component only reads this
 * LAZILY, at render time, which is always after this assignment.
 */
window.__markiiReact = React;

/**
 * `defaultRegistry` merged with every pack this webview's `<script>` tags
 * registered — see `./pack-registry.ts`. Built once, at mount time.
 *
 * ISSUE #20: any invalid registration, namespace collision, or
 * duplicate-composed-name skip this merge found is forwarded to the
 * extension host as a `pack-diagnostics` message, so it reaches the Markii
 * output channel (AGENTS.md's "clean is not silent") rather than only the
 * webview's own devtools console, which most users never open.
 */
const registrationResult = buildRenderRegistry(defaultRegistry);
const registry = registrationResult.registry;

if (
  registrationResult.invalidReasons.length > 0 ||
  registrationResult.collisions.length > 0 ||
  registrationResult.duplicateComposedNames.length > 0
) {
  const message: PackDiagnosticsMessage = {
    type: 'pack-diagnostics',
    invalidReasons: registrationResult.invalidReasons,
    collisions: registrationResult.collisions,
    duplicateComposedNames: registrationResult.duplicateComposedNames,
  };
  getVsCodeApi().postMessage(message);
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <Preview registry={registry} />
    </StrictMode>,
  );
}

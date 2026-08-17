/**
 * Typed wrapper around the `acquireVsCodeApi()` global VS Code injects into
 * every webview document. The real function is only usable in the webview
 * runtime (never in tests, never in the extension host) and — critically —
 * throws if called more than once per webview instance, so `getVsCodeApi`
 * exists to guarantee exactly one call for the whole session.
 */

import { isSafeBaseUri } from '../protocol.js';

/** The persisted-state shape this extension actually stores — see `preview.tsx`. */
export interface PersistedState {
  readonly text: string;
  readonly revision: number;
  /** The last `baseUri` this webview was given (`protocol.ts`), so a rehydrated preview resolves relative images correctly in the instant before the host's re-post arrives. Absent for a document with no folder. */
  readonly baseUri?: string;
}

/** The subset of the real `acquireVsCodeApi()` return value this extension uses. */
export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: PersistedState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cachedApi: VsCodeApi | undefined;

/** Returns the one `VsCodeApi` instance for this webview, calling the ambient `acquireVsCodeApi()` exactly once (a second real call would throw). */
export function getVsCodeApi(): VsCodeApi {
  cachedApi ??= acquireVsCodeApi();
  return cachedApi;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows an `unknown` value (whatever `getState()` handed back — persisted state is never trusted as-is) into `PersistedState`, or `undefined` if it doesn't match. */
function isPersistedState(value: unknown): value is PersistedState {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'text') || typeof value.text !== 'string') return false;
  if (
    !hasOwn(value, 'revision') ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision)
  ) {
    return false;
  }
  // Same rule as the wire format (`isHostToWebviewMessage`): absent or
  // `undefined` is fine, anything present must pass the ONE base-URI check,
  // which lives in `protocol.ts` rather than being restated here. Persisted
  // state is attacker-reachable in principle (it round-trips through the
  // editor's webview state store), so a hostile base saved by an older or
  // tampered state must not come back as a valid one.
  if (
    hasOwn(value, 'baseUri') &&
    value.baseUri !== undefined &&
    !isSafeBaseUri(value.baseUri)
  ) {
    return false;
  }
  return true;
}

/** Reads and validates whatever this webview last persisted via `setPersistedState`, surviving a tab-hidden reload. Never trusts the raw value — an old/foreign/corrupt state shape degrades to `undefined`, the same as no persisted state at all. */
export function getPersistedState(): PersistedState | undefined {
  const raw: unknown = getVsCodeApi().getState();
  return isPersistedState(raw) ? raw : undefined;
}

/** Persists `state` so it survives this webview being torn down (hidden, per `retainContextWhenHidden: false`) and recreated later. */
export function setPersistedState(state: PersistedState): void {
  getVsCodeApi().setState(state);
}

/**
 * The host (extension host, `preview-panel.ts`) <-> webview (`webview/
 * preview.tsx`) message contract. Both directions are tiny, closed unions —
 * the host only ever pushes a full document `update`, the webview only ever
 * announces it is ready to receive one — so the type guards below are the
 * entire wire-format validation this extension needs.
 *
 * Both guards take `unknown` and never throw: a message arriving via
 * `postMessage`/`onDidReceiveMessage` is attacker- or bug-reachable in
 * either direction (a compromised/misbehaving webview on one side, a stale
 * or malformed message on the other), so nothing here may assume shape.
 * Every field is read via `Object.prototype.hasOwnProperty.call` before use
 * — the same null-proto/hasOwn discipline `@markii/runtime`'s
 * `createValueStore` (`packages/markii-runtime/src/store.ts`) applies to
 * script-provided names — so an object that only *inherits* a `type`
 * property from its prototype chain (rather than owning one) is correctly
 * rejected instead of silently resolving through the prototype.
 */

/** Host -> webview: the current document text at `revision`. */
export interface UpdateMessage {
  readonly type: 'update';
  readonly revision: number;
  readonly text: string;
}

/** Webview -> host: the webview's message listener has attached and it is ready to receive the first `update`. */
export interface ReadyMessage {
  readonly type: 'ready';
}

export type HostToWebviewMessage = UpdateMessage;
export type WebviewToHostMessage = ReadyMessage;

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** True for a non-null, non-array object — the only shape either message type can ever be. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A valid `revision`: a finite, non-negative integer. Rejects `NaN`, `±Infinity`, negative numbers, and non-integers. */
function isValidRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isHostToWebviewMessage(
  value: unknown,
): value is HostToWebviewMessage {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'type') || value.type !== 'update') return false;
  if (!hasOwn(value, 'revision') || !isValidRevision(value.revision)) {
    return false;
  }
  if (!hasOwn(value, 'text') || typeof value.text !== 'string') return false;
  return true;
}

export function isWebviewToHostMessage(
  value: unknown,
): value is WebviewToHostMessage {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'type') || value.type !== 'ready') return false;
  return true;
}

/**
 * True when `incoming` is a newer revision than `lastSeen` — a strict `>`
 * comparison, so a repeated or out-of-order delivery of the same or an
 * older revision is never applied. Both arguments must be finite integers;
 * anything else (a caller passing `NaN`/`Infinity`/a non-integer through)
 * returns `false` rather than throwing or comparing nonsensically.
 */
export function isNewerRevision(lastSeen: number, incoming: number): boolean {
  if (!Number.isInteger(lastSeen) || !Number.isInteger(incoming)) {
    return false;
  }
  return incoming > lastSeen;
}

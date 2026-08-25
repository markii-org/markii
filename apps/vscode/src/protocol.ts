/**
 * The host (extension host, `preview-panel.ts`) <-> webview (`webview/
 * preview.tsx`) message contract. The host pushes a full document `update`
 * or a script-run `values` result; the webview only ever announces it is
 * ready to receive one — so the type guards below are the entire
 * wire-format validation this extension needs.
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
import {
  FAILURE_KINDS,
  type FailureKind,
  type RunTrigger,
  type ValueStatus,
} from '@markii/runtime';
import type { ValuesFailure } from '@markii/host';

export type { ValuesFailure } from '@markii/host';

/** Host -> webview: the current document text at `revision`. */
export interface UpdateMessage {
  readonly type: 'update';
  readonly revision: number;
  readonly text: string;
  /**
   * Absolute webview URI of the FOLDER the previewed document lives in,
   * with a trailing `/` (`webview.asWebviewUri` of the document's parent
   * directory) — what the webview resolves document-relative image sources
   * against, so `:::figure{src="nice.png"}` finds the file sitting next to
   * the note. Omitted for a document that has no folder (an unsaved
   * `untitled:` buffer), in which case the webview simply leaves relative
   * sources alone; absolute `https://` images never depend on it.
   */
  readonly baseUri?: string;
  /**
   * Bundle asset images, embedded as `data:` URIs and keyed by their
   * bundle-relative path (e.g. `assets/nice.png`) — the read-only zip-form
   * bundle preview's substitute for `baseUri`: a webview cannot reach into a
   * zip archive to load an image the way it loads a real file under
   * `localResourceRoots`, so the host extracts recognized image types ahead
   * of time (`bundle-resolve.ts`'s `extractAssetsAsDataUris`) and sends them
   * inline instead. Absent for a plain document or a directory-form bundle,
   * both of which resolve images via `baseUri` as usual.
   */
  readonly assets?: Readonly<Record<string, string>>;
  /**
   * True for a zip-form bundle preview: the archived document has no
   * editable buffer behind it, so edits are never tracked and this flag is
   * the ONLY thing that tells the webview to say so (a quiet marker, not a
   * dump — AGENTS.md's cleanliness principle). Absent (falsy) for a plain
   * document or a directory-form bundle, both of which track a real file.
   */
  readonly readOnly?: boolean;
  /**
   * The namespaces of every pack `preview-panel.ts` currently has installed
   * (GitHub issue #3 slice 5, docs/packs.md's `uses:` surfacing) — what the
   * webview resolves a note's own `uses:` frontmatter declaration against
   * via `@markii/pack`'s `resolveUses`, to show a quiet "pack not
   * installed" marker instead of an unexplained fallback box. Omitted (not
   * merely empty) when no packs are configured at all, so the webview can
   * tell "zero packs installed" apart from "the host didn't say" — though
   * both currently degrade the same way (an empty install set).
   */
  readonly packNamespaces?: readonly string[];
  /**
   * How many configured `markii.packs` folders failed to produce a usable
   * pack, as of the most recent pack load (`./packs/pack-diagnostics.ts`'s
   * `skippedPackCount`) — what the webview counts for its quiet "N packs
   * failed to load" marker (AGENTS.md's cleanliness principle: a marker in
   * the note plus a full diagnostic in the host's Output channel, reachable
   * via the `Markii: Show Diagnostics` command). Omitted (not zero) when no
   * packs are configured at all, matching `packNamespaces`'s own
   * omitted-vs-empty convention; the webview treats both the same (no
   * marker).
   */
  readonly packSkippedCount?: number;
  /**
   * ITEM 3 (AGENTS.md "clean is not silent"): the outcome of the most
   * recent `'manual'`/`'auto'`/`'scheduled'` run of this document's scripts
   * (`@markii/host`'s `run/run-trace.ts` persisted `RunTrace`), independent of what
   * values that run produced — a re-run that leaves every value unchanged
   * is otherwise indistinguishable from one that never happened. Omitted
   * when no run has ever completed for this document, in which case the
   * webview shows no run marker at all.
   */
  readonly lastRun?: WireRunTrace;
}

/**
 * One run's outcome, as it crosses the wire — the `@markii/host`'s `run/run-trace.ts`
 * `RunTrace` shape restated here so this file's own hostile-shape guard
 * owns the wire validation, matching `WireStoredValue`'s pattern just below.
 */
export interface WireRunTrace {
  readonly trigger: RunTrigger;
  readonly ranAt: number;
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Host -> webview: a bundle could not be resolved into something
 * previewable (missing/invalid manifest.json, or a missing document) —
 * `bundle-resolve.ts` computed the reason and reduced it to `message`, a
 * short, specific, non-stack-trace sentence. The webview shows it in place
 * of a document, exactly as `PreviewErrorBoundary` shows its own quiet
 * message for a render-time failure — never a raw error, per the
 * cleanliness principle.
 */
export interface BundleErrorMessage {
  readonly type: 'bundle-error';
  readonly revision: number;
  readonly message: string;
}

/**
 * One value-store entry as it crosses the wire — structurally the same
 * shape as `@markii/runtime`'s `StoredValue`, restated here rather than
 * imported so this file's own hostile-shape guard owns the validation
 * (mirroring `StoredValue`'s fields keeps `createValueStore(message.values)`
 * a direct, no-conversion call on the webview side — see `webview/
 * preview.tsx`).
 */
export interface WireStoredValue {
  readonly value: unknown;
  readonly status: ValueStatus;
  readonly error?: string;
  readonly failureKind?: FailureKind;
  readonly ranAt?: number;
}

/**
 * Host -> webview: the outcome of a manual `markii.runScripts` run at
 * `revision` — the value store's contents plus which named scripts failed
 * and how. `revision` is the text revision the run was actually performed
 * against (captured at Run time), NOT necessarily the webview's most recent
 * `update` — a run started against an older revision, if the document kept
 * changing while it ran, still reports the revision it ran against so the
 * webview can recognize and drop a now-stale result (see `isNewerRevision`'s
 * sibling `isNewerRevision`-adjacent check the webview does on receipt).
 */
export interface ValuesMessage {
  readonly type: 'values';
  readonly revision: number;
  readonly values: Readonly<Record<string, WireStoredValue>>;
  readonly failures: readonly ValuesFailure[];
  /**
   * ITEM 3: the SAME run's own outcome, attached directly to its own
   * `values` result so a successful run's marker updates immediately —
   * without waiting for the next `update` — rather than only ever being
   * read back from storage on a later reopen (`preview-panel.ts`'s
   * `postUpdate` still does that too, for the rehydration case). Omitted
   * for `postStalePersistedValues`'s rehydration-only `values` message,
   * which carries no run of its own to report.
   */
  readonly lastRun?: WireRunTrace;
}

/** Webview -> host: the webview's message listener has attached and it is ready to receive the first `update`. */
export interface ReadyMessage {
  readonly type: 'ready';
}

export type HostToWebviewMessage =
  UpdateMessage | ValuesMessage | BundleErrorMessage;
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

/**
 * Schemes a `baseUri` may carry. `vscode.Webview.asWebviewUri` returns an
 * `https:` URL on current VS Code desktop and web builds
 * (`https://file+.vscode-resource.vscode-cdn.net/...`) and the older
 * `vscode-resource:`/`vscode-webview-resource:` forms on older or
 * differently-hosted builds, so all of those are accepted — while
 * `javascript:`, `data:`, `blob:` and everything else are not. The webview
 * feeds this value to `new URL(src, baseUri)`, so an attacker-chosen scheme
 * here would become the scheme of every relative image in the document.
 */
const BASE_URI_SCHEMES: ReadonlySet<string> = new Set([
  'https:',
  'http:',
  'vscode-resource:',
  'vscode-webview-resource:',
  'vscode-file:',
]);

/**
 * A sane upper bound on a base URI. Real ones are a file-system path plus a
 * host (well under a kilobyte); the cap exists so a hostile multi-megabyte
 * string can never be parsed, stored via `setState`, or prefixed onto every
 * image URL in a document.
 */
const MAX_BASE_URI_LENGTH = 4096;

/**
 * True for a base URI this extension is willing to resolve relative image
 * sources against: a bounded, absolute, parseable URL whose scheme is in
 * `BASE_URI_SCHEMES`. Everything else — a non-string, an empty string, a
 * relative URL, `javascript:alert(1)`, a `data:` payload, a giant string —
 * is rejected.
 *
 * Exported because the webview's persisted state (`webview/vscode-api.ts`)
 * carries a base URI too and must apply the exact same check to it rather
 * than trusting whatever `getState()` hands back.
 */
export function isSafeBaseUri(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_BASE_URI_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return BASE_URI_SCHEMES.has(parsed.protocol);
}

/**
 * A sane upper bound on one embedded asset's `data:` URI — base64 inflates
 * bytes by roughly a third, so this comfortably covers
 * `bundle-resolve.ts`'s `DEFAULT_MAX_EMBEDDED_ASSET_BYTES` total budget for
 * a single entry while still rejecting an implausibly, hostilely large one.
 */
const MAX_ASSET_DATA_URI_LENGTH = 32 * 1024 * 1024;

/** A sane upper bound on how many distinct asset entries one `update` message may carry. */
const MAX_ASSET_ENTRIES = 1000;

/** True for a value this extension is willing to treat as one embedded asset: a bounded `data:` URI string. */
function isSafeAssetDataUri(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ASSET_DATA_URI_LENGTH &&
    value.startsWith('data:')
  );
}

/** Every OWN entry of `value` is a bounded `data:` URI, same `Object.keys`-only-visits-own-properties discipline as `isWireStoredValueRecord`. */
function isAssetsRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > MAX_ASSET_ENTRIES) return false;
  return keys.every((key) => isSafeAssetDataUri(value[key]));
}

function isUpdateMessage(value: unknown): value is UpdateMessage {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'type') || value.type !== 'update') return false;
  if (!hasOwn(value, 'revision') || !isValidRevision(value.revision)) {
    return false;
  }
  if (!hasOwn(value, 'text') || typeof value.text !== 'string') return false;
  // `baseUri` is optional — a document with no folder omits it entirely, and
  // an own property explicitly set to `undefined` (which `postMessage`'s
  // structured clone preserves) counts as omitted. Present-and-anything-else
  // rejects the WHOLE message rather than dropping just the field: a message
  // carrying a hostile base is a hostile message, and the previous revision
  // stays on screen, which is the quiet degradation the cleanliness
  // principle asks for.
  if (
    hasOwn(value, 'baseUri') &&
    value.baseUri !== undefined &&
    !isSafeBaseUri(value.baseUri)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'assets') &&
    value.assets !== undefined &&
    !isAssetsRecord(value.assets)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'readOnly') &&
    value.readOnly !== undefined &&
    typeof value.readOnly !== 'boolean'
  ) {
    return false;
  }
  if (
    hasOwn(value, 'packNamespaces') &&
    value.packNamespaces !== undefined &&
    !isPackNamespacesArray(value.packNamespaces)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'packSkippedCount') &&
    value.packSkippedCount !== undefined &&
    !isValidSkippedCount(value.packSkippedCount)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'lastRun') &&
    value.lastRun !== undefined &&
    !isWireRunTrace(value.lastRun)
  ) {
    return false;
  }
  return true;
}

/** A valid `RunTrigger`: exactly one of `@markii/runtime`'s three trigger literals. */
function isValidRunTrigger(value: unknown): value is RunTrigger {
  return value === 'manual' || value === 'auto' || value === 'scheduled';
}

/** A sane upper bound on a run-failure reason — real ones are one short phrase (`preview-panel.ts` never forwards a raw stack, per AGENTS.md's cleanliness principle). */
const MAX_RUN_REASON_LENGTH = 4096;

function isWireRunTrace(value: unknown): value is WireRunTrace {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'trigger') || !isValidRunTrigger(value.trigger)) {
    return false;
  }
  if (
    !hasOwn(value, 'ranAt') ||
    typeof value.ranAt !== 'number' ||
    !Number.isFinite(value.ranAt)
  ) {
    return false;
  }
  if (!hasOwn(value, 'ok') || typeof value.ok !== 'boolean') return false;
  if (
    hasOwn(value, 'reason') &&
    value.reason !== undefined &&
    (typeof value.reason !== 'string' ||
      value.reason.length > MAX_RUN_REASON_LENGTH)
  ) {
    return false;
  }
  return true;
}

/** A sane upper bound on how many pack namespaces one `update` message may list — real installs are a handful; this only exists to bound a hostile/corrupt message. */
const MAX_PACK_NAMESPACES = 256;

/** A valid `packSkippedCount`: a finite, non-negative integer bounded the same way `MAX_PACK_NAMESPACES` bounds the namespace list — real counts are a handful of folders. */
function isValidSkippedCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_PACK_NAMESPACES
  );
}

/** Every entry of `value` is a non-empty string, and the array itself is within `MAX_PACK_NAMESPACES`. */
function isPackNamespacesArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PACK_NAMESPACES &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** A sane upper bound on a bundle-error message — real ones are one short sentence (`bundle-resolve.ts`'s `bundleResolutionFailureMessage`). */
const MAX_BUNDLE_ERROR_MESSAGE_LENGTH = 4096;

function isBundleErrorMessage(value: unknown): value is BundleErrorMessage {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'type') || value.type !== 'bundle-error') return false;
  if (!hasOwn(value, 'revision') || !isValidRevision(value.revision)) {
    return false;
  }
  if (
    !hasOwn(value, 'message') ||
    typeof value.message !== 'string' ||
    value.message.length === 0 ||
    value.message.length > MAX_BUNDLE_ERROR_MESSAGE_LENGTH
  ) {
    return false;
  }
  return true;
}

/** A valid `FailureKind`: exactly one of `@markii/runtime`'s closed `FAILURE_KINDS`, never a forged/renamed/stale string. */
function isValidFailureKind(value: unknown): value is FailureKind {
  return (
    typeof value === 'string' &&
    (FAILURE_KINDS as readonly string[]).includes(value)
  );
}

/** A valid `ValueStatus`: exactly one of `@markii/runtime`'s closed `StoredValue.status` values. */
function isValidValueStatus(value: unknown): value is ValueStatus {
  return (
    value === 'fresh' ||
    value === 'stale' ||
    value === 'error' ||
    value === 'missing'
  );
}

function isWireStoredValue(value: unknown): value is WireStoredValue {
  if (!isPlainObject(value)) return false;
  // `value` (the stored payload itself) may legitimately BE `undefined` —
  // what matters is that the property is OWNED, not inherited, same
  // discipline as every other field here.
  if (!hasOwn(value, 'value')) return false;
  if (!hasOwn(value, 'status') || !isValidValueStatus(value.status)) {
    return false;
  }
  if (
    hasOwn(value, 'error') &&
    value.error !== undefined &&
    typeof value.error !== 'string'
  ) {
    return false;
  }
  if (
    hasOwn(value, 'failureKind') &&
    value.failureKind !== undefined &&
    !isValidFailureKind(value.failureKind)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'ranAt') &&
    value.ranAt !== undefined &&
    (typeof value.ranAt !== 'number' || !Number.isFinite(value.ranAt))
  ) {
    return false;
  }
  return true;
}

/** Every OWN entry of `value` is a valid `WireStoredValue` — `Object.keys` already only enumerates own enumerable properties, so an entry inherited from a prototype is never visited (and therefore never trusted) here. */
function isWireStoredValueRecord(
  value: unknown,
): value is Record<string, WireStoredValue> {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!isWireStoredValue(value[key])) return false;
  }
  return true;
}

function isValuesFailure(value: unknown): value is ValuesFailure {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'name') || typeof value.name !== 'string') return false;
  if (!hasOwn(value, 'kind') || !isValidFailureKind(value.kind)) return false;
  return true;
}

function isValuesFailureArray(value: unknown): value is ValuesFailure[] {
  return Array.isArray(value) && value.every(isValuesFailure);
}

function isValuesMessage(value: unknown): value is ValuesMessage {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'type') || value.type !== 'values') return false;
  if (!hasOwn(value, 'revision') || !isValidRevision(value.revision)) {
    return false;
  }
  if (!hasOwn(value, 'values') || !isWireStoredValueRecord(value.values)) {
    return false;
  }
  if (!hasOwn(value, 'failures') || !isValuesFailureArray(value.failures)) {
    return false;
  }
  if (
    hasOwn(value, 'lastRun') &&
    value.lastRun !== undefined &&
    !isWireRunTrace(value.lastRun)
  ) {
    return false;
  }
  return true;
}

export function isHostToWebviewMessage(
  value: unknown,
): value is HostToWebviewMessage {
  return (
    isUpdateMessage(value) ||
    isValuesMessage(value) ||
    isBundleErrorMessage(value)
  );
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

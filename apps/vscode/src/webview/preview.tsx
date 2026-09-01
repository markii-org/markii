import { Component, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { renderMark } from '@markii/react';
import type { Registry } from '@markii/react';
import { createValueStore } from '@markii/runtime';
import type { StoredValue } from '@markii/runtime';
import { mergeArrivingValue } from '@markii/host/browser';
import { extractFrontmatterUses } from '@markii/core';
import { resolveUses } from '@markii/pack';
import { isHostToWebviewMessage, isNewerRevision } from '../protocol.js';
import type { WebviewToHostMessage, WireRunTrace } from '../protocol.js';
import { runMarkerLabel, runMarkerTitle } from './run-marker.js';
import { applyDocumentBase } from './document-images.js';
import {
  DEFAULT_PREVIEW_WIDTH,
  previewDocumentClassName,
} from '../preview-width.js';
import type { PreviewWidth } from '../preview-width.js';
import {
  getPersistedState,
  getVsCodeApi,
  setPersistedState,
} from './vscode-api.js';
import type { PersistedState } from './vscode-api.js';

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  /** Changing this value clears a caught error and re-tries rendering `children` — `Preview` passes the current `revision`, so a fixed/updated document is given a fresh chance instead of the crash message sticking forever. */
  resetKey: unknown;
}

interface PreviewErrorBoundaryState {
  hasError: boolean;
}

/**
 * Belt-and-suspenders around `renderMark`, mirroring
 * `apps/playground/src/PreviewErrorBoundary.tsx`: `renderMark` already
 * never throws (it catches internally), but a registered component's own
 * render function can still throw once React actually mounts/updates the
 * element tree, outside `renderMark`'s synchronous try/catch.
 *
 * Wording is QUIET, unlike the playground's boundary (AGENTS.md's
 * cleanliness principle: the rendered page shows quiet markers, never error
 * dumps or machinery) — one short sentence, no stack, no error message on
 * screen. The detail goes to `console.error` only, reachable via the
 * webview's own "Open Webview Developer Tools" command for anyone who needs
 * it.
 */
export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PreviewErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      'Markii preview failed to render:',
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: PreviewErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <p className="mk-preview__error" role="alert">
          This document could not be previewed.
        </p>
      );
    }
    return this.props.children;
  }
}

const READY_MESSAGE: WebviewToHostMessage = { type: 'ready' };

/**
 * One `values` message's contents, tagged with the text revision it was
 * computed against. Kept separate from the run's `failures` array — every
 * per-script failure a component needs to branch on is already embedded in
 * its own `StoredValue.failureKind` (`@markii/runtime`'s store), so nothing
 * here needs to thread `failures` through to rendering; it exists on the
 * wire only for a future host-side use (e.g. a status-bar summary).
 */
interface RunValues {
  readonly revision: number;
  readonly values: Record<string, StoredValue>;
}

/** This component's full local state: the persisted `{text, revision,
 * baseUri}` (`vscode-api.ts`'s `PersistedState`, unchanged) plus the
 * latest run output, NOT persisted — see `runValues`'s own doc comment on
 * why hiding/recreating the webview simply drops it rather than round-
 * tripping run results through `setState`.
 */
interface LocalState extends PersistedState {
  readonly runValues?: RunValues;
  /**
   * Set when the host could not resolve a bundle into something previewable
   * (`protocol.ts`'s `BundleErrorMessage`) — a short, quiet sentence shown
   * in place of the document, exactly like `PreviewErrorBoundary`'s own
   * message for a render-time failure. Cleared by the next `update`.
   */
  readonly bundleError?: string;
  /**
   * GitHub issue #3 slice 5 (docs/packs.md's `uses:` surfacing): the
   * namespaces of every pack the host currently has installed
   * (`protocol.ts`'s `UpdateMessage.packNamespaces`), as of the most recent
   * `update`. `undefined` only before the first `update` arrives; the host
   * always sends the field (possibly empty) once loaded.
   */
  readonly packNamespaces?: readonly string[];
  /**
   * ITEM 3 (AGENTS.md "clean is not silent"): the most recently recorded
   * run outcome for this document (`protocol.ts`'s `WireRunTrace`) — drives
   * the quiet "ran Nm ago" / "run failed Nm ago" footer marker, so a
   * `'scheduled'`/`'auto'` run that changes nothing is still visibly not
   * "nothing happened". `undefined` until a run's outcome (or a rehydrated
   * one) has ever arrived for this document.
   */
  readonly lastRun?: WireRunTrace;
  /**
   * ITEM 2 (AGENTS.md "clean is not silent"): how many configured
   * `markii.packs` folders failed to produce a usable pack, as of the most
   * recent `update` (`protocol.ts`'s `UpdateMessage.packSkippedCount`).
   * Drives the quiet "N packs failed to load" marker below, in the same
   * visual register as `packNamespaces`'s own uses-marker; `undefined`
   * (no `update` yet, or the host omitted it) is treated as "nothing
   * failed", so the marker is absent until a real count arrives.
   */
  readonly packSkippedCount?: number;
  /**
   * The reading measure the host was configured with
   * (`protocol.ts`'s `UpdateMessage.previewWidth`), as of the most recent
   * `update`. Cosmetic only, and `undefined` until the first `update`
   * arrives, which renders as `normal` — the width the preview has always
   * had.
   */
  readonly previewWidth?: PreviewWidth;
  /**
   * Whether the host asked for script markers to be hidden
   * (`markii.hideScriptBlocks`, `protocol.ts`'s
   * `UpdateMessage.hideScriptBlocks`), as of the most recent `update`.
   * Absent means no, the way the preview has always rendered.
   */
  readonly hideScriptBlocks?: boolean;
}

export interface PreviewProps {
  /** `defaultRegistry` merged with every pack `main.tsx` registered (`./pack-registry.ts`) — passed in rather than imported here so this component stays agnostic to WHERE the registry came from. */
  registry: Registry;
}

function initialState(): LocalState {
  return getPersistedState() ?? { text: '', revision: 0 };
}

/**
 * The webview's root component. Holds `{text, revision, baseUri}` (plus,
 * separately, the last run's output) in state, seeded on mount from
 * whatever was last persisted via `setState` (`vscode-api.ts`) so a
 * hidden/recreated webview (this extension runs with
 * `retainContextWhenHidden: false` — see `preview-panel.ts`) rehydrates
 * instantly instead of flashing empty before the host's re-post arrives.
 *
 * On mount it posts `{type: 'ready'}` exactly once — the handshake
 * `preview-panel.ts` waits for before sending the first `update`, so the
 * very first `postMessage` can never be dropped for arriving before this
 * component's message listener has attached.
 *
 * Rendering feeds `renderMark` a value store built from the most recent
 * `values` message THAT STILL MATCHES THE CURRENT TEXT REVISION — see
 * `store`'s own comment. With no matching run yet, `renderMark` gets no
 * store at all: script blocks show the renderer's collapsed marker and
 * data-bound components show their standard empty states, exactly as
 * before `markii.runScripts` existed.
 */
export function Preview({ registry }: PreviewProps): ReactElement {
  const [state, setState] = useState<LocalState>(initialState);
  const documentRef = useRef<HTMLDivElement>(null);
  // ITEM 3: the run marker's relative-time label ("ran 2m ago") is a
  // function of wall-clock time, not just of `state` — without a ticking
  // clock it would freeze at whatever it read on the message that set
  // `lastRun`, drifting further from the truth the longer the panel stays
  // open. Ticked coarsely (once a minute — matching the label's own
  // minute-level granularity) rather than every second, since a stale
  // second is never visible in a "Nm ago" phrase anyway.
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    // Mount-only: this handshake happens exactly once per webview instance.
    getVsCodeApi().postMessage(READY_MESSAGE);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent<unknown>): void {
      const data = event.data;
      if (!isHostToWebviewMessage(data)) return;
      setState((previous) => {
        if (data.type === 'update') {
          if (!isNewerRevision(previous.revision, data.revision)) {
            return previous;
          }
          return {
            text: data.text,
            revision: data.revision,
            baseUri: data.baseUri,
            assets: data.assets,
            readOnly: data.readOnly,
            // A run's output is tied to the revision it ran against; a
            // fresh `update` can never match that revision again (revision
            // numbers only increase), so there's nothing to carry forward.
            runValues: undefined,
            bundleError: undefined,
            packNamespaces: data.packNamespaces,
            packSkippedCount: data.packSkippedCount,
            // ITEM 3: rehydrated from storage by `postUpdate` — see
            // `preview-panel.ts`'s `readLastRunTrace`. `undefined` when no
            // run has ever completed for this document, in which case the
            // marker below stays absent, same as `packNamespaces`'s own
            // omitted-vs-empty convention.
            lastRun: data.lastRun,
            previewWidth: data.previewWidth,
            hideScriptBlocks: data.hideScriptBlocks,
          };
        }
        if (data.type === 'bundle-error') {
          if (!isNewerRevision(previous.revision, data.revision)) {
            return previous;
          }
          return {
            text: '',
            revision: data.revision,
            baseUri: undefined,
            assets: undefined,
            readOnly: undefined,
            runValues: undefined,
            bundleError: data.message,
            // Cosmetic and panel-wide: a bundle that failed to resolve is
            // still shown at the width the panel was opened at, and with
            // the script-marker preference it was opened with.
            previewWidth: previous.previewWidth,
            hideScriptBlocks: previous.hideScriptBlocks,
          };
        }
        // `export-request` (GitHub issue #28 slice 2) is `./main.tsx`'s own
        // listener's concern, not this component's — it carries no
        // `revision` and is never state this preview renders from.
        if (data.type === 'export-request') return previous;
        if (data.type === 'value') {
          // GitHub issue #35: ONE script's value, arriving mid-run. Same
          // stale-revision rule as a whole `values` result below: a value
          // computed against text this preview is no longer showing is
          // dropped rather than applied.
          if (data.revision !== previous.revision) return previous;
          // Folded onto whatever store is already on screen — the previous
          // run's values, or the stale rehydrated ones — so this name goes
          // fresh and every other name keeps the status it had. That is
          // the whole point: a running note shows its values filling in
          // one at a time, not all at the end.
          return {
            ...previous,
            runValues: {
              revision: data.revision,
              values: mergeArrivingValue(
                previous.runValues?.revision === data.revision
                  ? previous.runValues.values
                  : undefined,
                data.name,
                data.value,
              ),
            },
          };
        }
        // A `values` result for anything other than the CURRENT text
        // revision is stale — e.g. the document kept changing while the
        // run was in flight — and is dropped rather than applied.
        if (data.revision !== previous.revision) return previous;
        return {
          ...previous,
          runValues: { revision: data.revision, values: data.values },
          // ITEM 3: a successful run's own outcome rides along on its
          // `values` message so the marker updates immediately, without
          // waiting for the next `update` (`protocol.ts`'s
          // `ValuesMessage.lastRun`'s doc comment). A stale-value
          // rehydration `values` message (`postStalePersistedValues`)
          // carries no `lastRun` and so leaves the existing marker alone.
          ...(data.lastRun ? { lastRun: data.lastRun } : {}),
        };
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Persistence is an EFFECT, never a side effect inside the `setState`
  // updater above: React may invoke an updater more than once for the same
  // transition (StrictMode does so deliberately), and an updater that writes
  // to the outside world is not a pure function of its previous state. Here
  // it runs once per applied state, which is exactly the rehydration
  // contract `preview-panel.ts` documents. Only the `PersistedState` fields
  // are written back out — `runValues` is deliberately not part of the
  // persisted shape (see `LocalState`'s doc comment).
  useEffect(() => {
    setPersistedState({
      text: state.text,
      revision: state.revision,
      baseUri: state.baseUri,
      assets: state.assets,
      readOnly: state.readOnly,
    });
  }, [state.text, state.revision, state.baseUri, state.assets, state.readOnly]);

  // Only a run whose revision still matches the CURRENTLY DISPLAYED text
  // counts — this is the other half of the stale-revision drop above (that
  // one guards what gets ACCEPTED into state; this guards what gets USED,
  // in case `runValues` from a since-superseded revision were ever still
  // sitting in state).
  const store = useMemo(() => {
    if (!state.runValues || state.runValues.revision !== state.revision) {
      return undefined;
    }
    return createValueStore(state.runValues.values);
  }, [state.runValues, state.revision]);

  const rendered = useMemo(
    () => renderMark(state.text, registry, store),
    [state.text, registry, store],
  );

  /**
   * GitHub issue #3 slice 5 (docs/packs.md's `uses:` surfacing): resolves
   * the document's own declared `uses:` frontmatter against the packs the
   * host actually has installed (`state.packNamespaces`, from the most
   * recent `update`). Purely informational — this never blocks rendering;
   * a directive from a missing pack already shows the ordinary
   * unknown-component fallback box regardless. `undefined`
   * `packNamespaces` (no `update` received yet) is treated as "nothing
   * installed", which only matters for the instant before the first
   * `update` arrives.
   */
  const usesResolution = useMemo(
    () =>
      resolveUses(
        extractFrontmatterUses(state.text),
        state.packNamespaces ?? [],
      ),
    [state.text, state.packNamespaces],
  );

  // Relative image sources are resolved against the document's folder AFTER
  // each render, in the DOM, rather than anywhere inside the renderer — see
  // `document-images.ts` for why that boundary is where it is. Re-runs
  // whenever the rendered tree or the folder changes.
  useEffect(() => {
    const container = documentRef.current;
    if (container) {
      applyDocumentBase(container, state.baseUri, state.assets);
    }
  }, [rendered, state.baseUri, state.assets]);

  if (state.bundleError !== undefined) {
    return (
      <p className="mk-preview__error" role="alert">
        {state.bundleError}
      </p>
    );
  }

  return (
    <PreviewErrorBoundary resetKey={state.revision}>
      {/*
        `key` is the base URI so that switching to a document in a DIFFERENT
        folder remounts the tree instead of letting React reuse an `<img>`
        whose `src` prop is unchanged (`nice.png` in both documents) — a
        reused element keeps the absolute URL the effect above already wrote
        into it, which would point at the OLD folder. Remounting restores the
        relative source, and the effect re-resolves it against the new base.
      */}
      <div
        className={previewDocumentClassName(
          state.previewWidth ?? DEFAULT_PREVIEW_WIDTH,
          state.hideScriptBlocks === true,
        )}
        ref={documentRef}
        key={state.baseUri ?? ''}
      >
        {state.readOnly === true && (
          <p className="mk-preview__readonly-marker">
            Read-only bundle preview
          </p>
        )}
        {state.lastRun && (
          <p
            className={
              state.lastRun.ok
                ? 'mk-preview__run-marker'
                : 'mk-preview__run-marker mk-preview__run-marker--failed'
            }
            title={runMarkerTitle(state.lastRun)}
          >
            {runMarkerLabel(state.lastRun, now)}
          </p>
        )}
        {typeof state.packSkippedCount === 'number' &&
          state.packSkippedCount > 0 && (
            <p
              className="mk-preview__pack-failure-marker"
              title={
                'Run "Markii: Show Diagnostics" to see which pack folders failed and why.'
              }
            >
              {state.packSkippedCount === 1
                ? '1 pack failed to load'
                : `${state.packSkippedCount} packs failed to load`}
            </p>
          )}
        {usesResolution.missing.length > 0 && (
          <p
            className="mk-preview__uses-marker"
            title={`This note declares packs that are not installed: ${usesResolution.missing.join(', ')}. Add their folders to the markii.packs setting to enable them.`}
          >
            {usesResolution.missing.length === 1
              ? `Pack not installed: ${usesResolution.missing[0]}`
              : `Packs not installed: ${usesResolution.missing.join(', ')}`}
          </p>
        )}
        {rendered}
      </div>
    </PreviewErrorBoundary>
  );
}

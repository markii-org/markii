import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { renderMark } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import { extractScripts, parse } from '@markii/core';
import { createValueStore, runDocumentScripts } from '@markii/runtime';
import type { RunSummary } from '@markii/runtime';
import { createLuaExecutor } from '@markii/lua';
import {
  createFetchNetProvider,
  createMemoryCacheProvider,
  DEMO_NET_GRANTS,
} from './script-host';
// Vite `?url` asset import: ships wasmoon's `glue.wasm` as a hashed file in
// this app's own build output and resolves to that local URL at runtime,
// instead of `@markii/lua`'s default (unconfigured) browser behavior of
// fetching it from `https://unpkg.com/wasmoon@<version>/dist/glue.wasm` —
// see `@markii/lua`'s `createEmptyLuaEngine`/`RunScriptOptions` doc comments
// for why that CDN default exists and why a host would want to avoid it.
// `*?url` is typed by `vite/client` (already in this app's `tsconfig.json`).
import wasmUrl from 'wasmoon/dist/glue.wasm?url';
import { CodeEditor } from './CodeEditor';
import { PreviewErrorBoundary } from './PreviewErrorBoundary';
import { getParseStatus } from './parse-status';
import { DEMO_DOC } from './demo-doc';

const DEBOUNCE_MS = 200;

/**
 * The Lua executor closes over one fixed capability configuration for the
 * whole session: a real `fetch`-backed `NetProvider`, the demo's GET grant
 * (`api.github.com`), and an in-memory `CacheProvider`. Built once at
 * module scope (not per render/run) — matching how `@markii/lua`'s
 * `LuaExecutorConfig` doc comment describes it: "captured once and reused
 * for every script the returned executor runs".
 *
 * SECURITY NOTE (spec §10): this executor runs wasmoon **on the main
 * thread**. Per DESIGN.md §10, a real host MUST run note scripts in a
 * dedicated, terminatable Web Worker with an EXTERNAL wall-clock watchdog
 * that calls `terminate()` — in-VM limits alone cannot guarantee a hostile
 * or hung script can be stopped. Running on the main thread here is
 * acceptable ONLY because this is a dev harness executing the *author's
 * own* trusted demo script, not a host rendering untrusted notes. Do not
 * copy this pattern into a production renderer.
 */
const luaExecutor = createLuaExecutor({
  net: createFetchNetProvider(),
  netGrants: DEMO_NET_GRANTS,
  cache: createMemoryCacheProvider(),
  // Local bundled asset (see the `wasmUrl` import above) — keeps this dev
  // harness offline-capable instead of depending on the unpkg CDN at
  // script-run time.
  wasmUri: wasmUrl,
});

type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; summary: RunSummary };

function statusLine(runState: RunState): string {
  switch (runState.phase) {
    case 'idle':
      return 'not yet run — values below are missing until you click Run';
    case 'running':
      return 'running…';
    case 'done': {
      const { summary } = runState;
      const parts = summary.results.map((entry) =>
        entry.status === 'fresh'
          ? `${entry.name}: fresh`
          : `${entry.name}: error (${entry.error ?? 'unknown error'})`,
      );
      return `${summary.freshCount} fresh, ${summary.errorCount} error${
        summary.errorCount === 1 ? '' : 's'
      } — ${parts.join('; ')}`;
    }
  }
}

export function App(): ReactElement {
  const [source, setSource] = useState(DEMO_DOC);
  const [debounced, setDebounced] = useState(DEMO_DOC);
  const [runState, setRunState] = useState<RunState>({ phase: 'idle' });
  // The value store is a mutable, note-scoped object per DESIGN.md §8 — it
  // must persist for the life of the session (one store, created once),
  // never rebuilt per render, or a run's results would vanish on the next
  // keystroke. `useRef` (not `useState`) because the store's identity never
  // needs to change and mutating it in place must NOT itself trigger a
  // render — `renderVersion` below is the explicit signal for that.
  const storeRef = useRef(createValueStore());
  // The store is mutated in place by `runDocumentScripts`, so React has no
  // way to detect that new values are available — this counter is bumped
  // after a run completes purely to force the preview to re-render and pick
  // up the new store contents.
  const [renderVersion, setRenderVersion] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(source);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [source]);

  const parseStatus = useMemo(() => getParseStatus(debounced), [debounced]);

  const handleRun = useCallback(async (): Promise<void> => {
    setRunState({ phase: 'running' });
    const scripts = extractScripts(parse(source));
    const summary = await runDocumentScripts({
      scripts,
      executor: luaExecutor,
      trigger: 'manual',
      store: storeRef.current,
    });
    setRunState({ phase: 'done', summary });
    setRenderVersion((v) => v + 1);
  }, [source]);

  const isRunning = runState.phase === 'running';
  // `renderVersion` has no meaningful value of its own — it is included
  // purely so this memo recomputes after a run mutates `storeRef.current`
  // in place (see the doc comment above `renderVersion`'s declaration).
  const preview = useMemo(
    () => renderMark(debounced, defaultRegistry, storeRef.current),
    [debounced, renderVersion],
  );

  return (
    <div className="playground">
      <header className="playground__header">
        <h1>Mark Playground</h1>
        <p>
          A thin harness for viewing .mk.md source next to its rendered output.
        </p>
      </header>
      <main className="playground__panes">
        <section className="playground__pane">
          <h2 className="playground__pane-title">Source</h2>
          <CodeEditor
            className="playground__editor"
            value={source}
            onChange={setSource}
          />
        </section>
        <section className="playground__pane">
          <div className="playground__pane-title playground__pane-title--row">
            <span>Preview</span>
            <button
              type="button"
              className="playground__run-button"
              onClick={() => void handleRun()}
              disabled={isRunning}
            >
              {isRunning ? 'Running…' : 'Run scripts'}
            </button>
          </div>
          <div className="playground__preview">
            <PreviewErrorBoundary resetKey={debounced}>
              <div className="doc">{preview}</div>
            </PreviewErrorBoundary>
          </div>
          <p className="playground__scripting-status">{statusLine(runState)}</p>
          <p className="playground__status-bar">
            {parseStatus.ok
              ? `ok — ${parseStatus.directiveCount} directive${parseStatus.directiveCount === 1 ? '' : 's'} found`
              : `parse error — ${parseStatus.error}`}
          </p>
        </section>
      </main>
      <footer className="playground__footnote">
        Values are cached in the value store; rendering never runs scripts —
        only clicking Run does. Demo runs scripts on the main thread for
        simplicity; a production host must run them in a terminatable Web Worker
        with an external watchdog (DESIGN.md §10).
      </footer>
    </div>
  );
}

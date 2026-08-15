import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { renderSmd, defaultRegistry } from '@markii/react';
import { CodeEditor } from './CodeEditor';
import { PreviewErrorBoundary } from './PreviewErrorBoundary';
import { getParseStatus } from './parse-status';
import { DEMO_DOC } from './demo-doc';

const DEBOUNCE_MS = 200;

export function App(): ReactElement {
  const [source, setSource] = useState(DEMO_DOC);
  const [debounced, setDebounced] = useState(DEMO_DOC);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(source);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [source]);

  const parseStatus = useMemo(() => getParseStatus(debounced), [debounced]);

  return (
    <div className="playground">
      <header className="playground__header">
        <h1>Super Markdown Playground</h1>
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
          <h2 className="playground__pane-title">Preview</h2>
          <div className="playground__preview">
            <PreviewErrorBoundary resetKey={debounced}>
              <div className="doc">{renderSmd(debounced, defaultRegistry)}</div>
            </PreviewErrorBoundary>
          </div>
          <p className="playground__status-bar">
            {parseStatus.ok
              ? `ok — ${parseStatus.directiveCount} directive${parseStatus.directiveCount === 1 ? '' : 's'} found`
              : `parse error — ${parseStatus.error}`}
          </p>
        </section>
      </main>
    </div>
  );
}

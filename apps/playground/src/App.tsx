import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { renderSmd, defaultRegistry } from 'smd-core';
import { DEMO_DOC } from './demo-doc';

const DEBOUNCE_MS = 150;

export function App(): ReactElement {
  const [source, setSource] = useState(DEMO_DOC);
  const [debounced, setDebounced] = useState(DEMO_DOC);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(source);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [source]);

  return (
    <div className="playground">
      <header className="playground__header">
        <h1>Super Markdown Playground</h1>
        <p>
          A thin harness for viewing .smd source next to its rendered output.
        </p>
      </header>
      <main className="playground__panes">
        <section className="playground__pane">
          <h2 className="playground__pane-title">Source</h2>
          <textarea
            className="playground__editor"
            value={source}
            spellCheck={false}
            onChange={(event) => {
              setSource(event.target.value);
            }}
          />
        </section>
        <section className="playground__pane">
          <h2 className="playground__pane-title">Preview</h2>
          <div className="playground__preview">
            <div className="doc">{renderSmd(debounced, defaultRegistry)}</div>
          </div>
        </section>
      </main>
    </div>
  );
}

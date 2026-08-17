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
import { Preview } from './preview.js';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}

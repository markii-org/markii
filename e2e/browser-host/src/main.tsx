import { createRoot } from 'react-dom/client';
import '@markii/react/doc.css';
import { App } from './App';
import { probeWorker } from './worker-probe';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

// Debug hook for the e2e suite (tests/worker-isolation.spec.ts).
(window as unknown as { markiiProbeWorker: unknown }).markiiProbeWorker =
  probeWorker;

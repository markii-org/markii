import { createRoot } from 'react-dom/client';
import '@markii/react/doc.css';
import { App } from './App';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

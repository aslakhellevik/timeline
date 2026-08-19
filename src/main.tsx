import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/service-worker';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root element');

registerServiceWorker();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

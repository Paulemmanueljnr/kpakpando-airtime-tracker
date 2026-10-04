import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL;
    void navigator.serviceWorker.register(`${base}service-worker.js`, { scope: base }).catch(error => {
      console.error('Kpakpando offline support could not be registered.', error);
    });
    void navigator.serviceWorker.ready.then(registration => {
      registration.active?.postMessage({
        type: 'CACHE_READ_API',
        paths: [
          new URL('api/entries', registration.scope).href,
          new URL('api/dashboard/summary', registration.scope).href,
        ],
      });
    });
  });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

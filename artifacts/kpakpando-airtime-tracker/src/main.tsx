import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { API_URL } from '@/lib/airtime-api';

import './index.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL;
    const workerUrl = new URL(`${base}service-worker.js`, window.location.href);
    workerUrl.searchParams.set('api', API_URL);
    void navigator.serviceWorker.register(workerUrl.href, { scope: base }).catch(error => {
      console.error('Kpakpando offline support could not be registered.', error);
    });
    if (API_URL) {
      void navigator.serviceWorker.ready.then(registration => {
        registration.active?.postMessage({
        type: 'CACHE_READ_API',
        paths: [
          new URL('/api/entries', API_URL).href,
          new URL('/api/dashboard/summary', API_URL).href,
        ],
        });
      });
    }
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

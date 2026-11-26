import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Leaflet's own layout rules, bundled instead of linked from unpkg: the CSP's `style-src 'self'`
// refuses a CDN stylesheet, and without it the panes stack in document flow and nothing draws
// where it belongs (SCRUM-291). It goes before index.css so the app's overrides win.
import 'leaflet/dist/leaflet.css';
import './index.css';
import { reloadOnPreloadError } from './utils/preloadReload';

// A rebuild renames the lazy chunks; reload an open tab once instead of failing its exports.
reloadOnPreloadError();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

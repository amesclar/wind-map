import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { reloadOnPreloadError } from './utils/preloadReload';

// A rebuild renames the lazy chunks; reload an open tab once instead of failing its exports.
reloadOnPreloadError();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

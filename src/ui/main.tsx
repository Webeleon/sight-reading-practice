// Renderer entry point: mount the React app.
//
// Disposable layer (brief sections 2 & 5): React/DOM/Electron APIs are allowed here.
// This file only bootstraps; all UI lives in App.tsx and its descendants.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

console.log('[UI] renderer booting');

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[UI] #root element missing from index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

console.log('[UI] React mounted');

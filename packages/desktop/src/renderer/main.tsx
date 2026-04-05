import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initLogSubscription } from './hooks/useLogs';
import './styles/globals.css';

// Start capturing logs immediately (before React renders)
initLogSubscription();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

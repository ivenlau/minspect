import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
// Side-effect import: resolves and applies the saved / preferred theme
// synchronously before React renders, so the first paint already uses the
// right palette (no dark-flash for light-mode users).
import './theme';
// Same pattern for language — initialize the module-level `currentLang`
// before React mounts so `t()` returns the right strings on first paint.
import './i18n';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

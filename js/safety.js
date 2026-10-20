// ============================================================
// safety.js - Makes failures visible instead of silent:
//   - reportSaveFailure(): the project could not be written to the browser's storage
//   - global errors / unhandled promise rejections
//   - warning when Zern is already open in another tab (two tabs would overwrite each other)
// ============================================================

import { showToast } from './notifications.js';

// ---------------- Saving ----------------

let lastSaveWarning = 0;

export function reportSaveFailure(err) {
  console.warn('Could not save the project:', err);
  if (Date.now() - lastSaveWarning < 30000) return; // one warning every 30 s is enough
  lastSaveWarning = Date.now();
  showToast({
    type: 'error',
    title: 'Could not save your work in this browser',
    message: 'The browser storage may be full or blocked. Use File > Export Project as ZIP to keep a copy.',
    timeout: 12000,
  });
}

// ---------------- Unexpected errors ----------------

// Harmless noise that must never bother the user
const IGNORED = /ResizeObserver loop|^Script error\.?$|^Canceled$|AbortError|The user aborted a request/i;
let shown = 0;
let lastShown = 0;

function reportUnexpected(message) {
  const text = String(message || 'Unexpected error');
  if (IGNORED.test(text)) return;
  if (shown >= 5 || Date.now() - lastShown < 15000) return; // never turn a bug into a toast storm
  shown++;
  lastShown = Date.now();
  showToast({
    type: 'error',
    title: 'Something went wrong',
    message: `${text} If something stops working, reload the page.`,
    timeout: 10000,
  });
}

// ---------------- Two tabs ----------------

function initTabGuard() {
  if (!navigator.locks || typeof navigator.locks.request !== 'function') return;
  navigator.locks.request('zern-open-tab', { ifAvailable: true }, (lock) => {
    if (lock) return new Promise(() => {}); // keep the lock for as long as this tab lives
    showToast({
      type: 'warning',
      title: 'Zern is already open in another tab',
      message: 'Editing the same project in two tabs can overwrite changes. Close one of them.',
      timeout: 0,
    });
    return undefined;
  });
}

export function initSafety() {
  window.addEventListener('error', (e) => { if (e.error) reportUnexpected(e.error.message || e.message); });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && (r.name === 'Canceled' || r.name === 'AbortError')) return;
    reportUnexpected(r && (r.message || String(r)));
  });
  initTabGuard();
}

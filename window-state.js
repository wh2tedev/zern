// ============================================================
// window-state.js - Remembers the desktop window's size, position and
// maximized state between runs. Pure functions (no Electron imports) so
// `npm test` can check them; main.js does the wiring.
//
// Saved file (userData/window-state.json):
//   { "width": 1280, "height": 800, "x": 100, "y": 60, "maximized": false }
// x/y are optional: without them the window is centered.
// ============================================================
const fs = require('fs');
const path = require('path');

const DEFAULT_SIZE = { width: 1280, height: 800 };
const MIN_SIZE = { width: 820, height: 480 };   // keep in sync with main.js (below this the web layout hides the title bar)
const MIN_VISIBLE = { width: 120, height: 60 }; // how much of the window must be on a screen to be reachable

const isInt = (n) => typeof n === 'number' && Number.isFinite(n);

/** Keeps only valid fields from whatever was read from disk. Never throws. */
function sanitize(raw) {
  const out = { ...DEFAULT_SIZE, maximized: false };
  if (!raw || typeof raw !== 'object') return out;
  if (isInt(raw.width) && isInt(raw.height)) {
    out.width = Math.max(MIN_SIZE.width, Math.min(20000, Math.round(raw.width)));
    out.height = Math.max(MIN_SIZE.height, Math.min(20000, Math.round(raw.height)));
  }
  if (isInt(raw.x) && isInt(raw.y) && Math.abs(raw.x) < 100000 && Math.abs(raw.y) < 100000) {
    out.x = Math.round(raw.x);
    out.y = Math.round(raw.y);
  }
  out.maximized = raw.maximized === true;
  return out;
}

/** True when enough of `bounds` lies inside one of the work areas for the user to grab the title bar. */
function isReachable(bounds, workAreas) {
  return workAreas.some((a) => {
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const h = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return w >= MIN_VISIBLE.width && h >= MIN_VISIBLE.height && bounds.y >= a.y - 8; // the title bar must not hang above the screen
  });
}

/**
 * Applies the saved state to the screens available now.
 * - Too big for the biggest screen: shrunk to fit.
 * - Position off every screen (monitor unplugged, resolution changed): x/y dropped so Electron centers it.
 */
function fitToDisplays(state, workAreas) {
  const s = { ...state };
  if (!Array.isArray(workAreas) || !workAreas.length) return s;
  const maxW = Math.max(...workAreas.map((a) => a.width)), maxH = Math.max(...workAreas.map((a) => a.height));
  s.width = Math.max(Math.min(MIN_SIZE.width, maxW), Math.min(s.width, maxW));
  s.height = Math.max(Math.min(MIN_SIZE.height, maxH), Math.min(s.height, maxH));
  if (s.x !== undefined && s.y !== undefined && !isReachable({ x: s.x, y: s.y, width: s.width, height: s.height }, workAreas)) {
    delete s.x; delete s.y;
  }
  return s;
}

function load(file) {
  try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return sanitize(null); }
}

/** Writes atomically (temp file + rename) so a crash can never leave half a file. */
function save(file, state) {
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(sanitize(state)));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

/** Builds the state to store from a live window: normal (non-maximized) bounds + the maximized flag. */
function snapshot(win) {
  const b = win.getNormalBounds();
  return { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() };
}

/** Starts remembering `win`. Saves (debounced) while it moves/resizes and when it closes. */
function track(win, file, delay = 400) {
  let timer = null;
  const flush = () => { clearTimeout(timer); timer = null; if (!win.isDestroyed()) save(file, snapshot(win)); };
  const later = () => { clearTimeout(timer); timer = setTimeout(flush, delay); };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach((ev) => win.on(ev, later));
  win.on('close', flush);
}

module.exports = { DEFAULT_SIZE, MIN_SIZE, MIN_VISIBLE, sanitize, isReachable, fitToDisplays, load, save, snapshot, track };

// ============================================================
// session.js - Remembers which tabs were open (and where you were
// in each one: cursor, selection, scroll) and brings them back
// after a reload.
//
// What is stored (localStorage, one entry per project):
//   - the tab paths, in order, and which one was active
//   - each tab's Monaco view state (cursor/selection/scroll/folding)
// What is NOT stored: file contents. Tabs are re-read from the
// project, so you always get the current version of every file.
//
// A "root id" identifies the project the tabs belong to
// ("real:<folder name>" or "virtual"), so a session never leaks
// into a different project.
// ============================================================

import { AppState, getOpenFile } from './state.js';
import { findFileByPath, isImageExtension, getLanguageFromExtension, normalizePath } from './fs-utils.js';
import { ensureNodeContent } from './node-content.js';

const STORAGE_KEY = 'zern_session_v1';
const MAX_PROJECTS = 10;
const SAVE_DELAY = 500;

// Saving stays OFF until beginSession() is called. That's what keeps
// the app's empty first render (and a project we couldn't reopen yet,
// e.g. folder permission not re-granted) from wiping what was saved.
let activeRootId = null;
let saveTimer = null;
let flushListenersAttached = false;

// ---------------- Storage ----------------

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') return parsed;
  } catch (err) {
    console.warn('Could not read the saved session:', err);
  }
  return { sessions: {} };
}

function writeAll(all) {
  try {
    // Keep only the most recently saved projects.
    const entries = Object.entries(all.sessions).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
    all.sessions = Object.fromEntries(entries.slice(0, MAX_PROJECTS));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('Could not save the session:', err);
  }
}

// ---------------- Saving ----------------

function buildSnapshot() {
  const editor = AppState.editorInstance;
  const tabs = [];

  for (const [path, file] of AppState.openFiles.entries()) {
    if (file.isDiff || file.custom) continue; // diff tabs and settings.json are transient: they're not restored
    const entry = { path };
    if (!file.isImage) {
      // The active tab's live state lives in the editor; every other
      // tab's state was stored on the file when you switched away.
      const isShown = path === AppState.activeFilePath && editor && editor.getModel() === file.model;
      const viewState = isShown ? editor.saveViewState() : file.viewState;
      if (viewState) entry.viewState = viewState;
    }
    tabs.push(entry);
  }

  const activeFile = AppState.activeFilePath ? AppState.openFiles.get(AppState.activeFilePath) : null;
  const active = activeFile && (activeFile.isDiff || activeFile.custom) ? ((tabs[tabs.length - 1] || {}).path || null) : AppState.activeFilePath;
  return { tabs, active, savedAt: Date.now() };
}

/** Saves the current tabs and stops further saving until beginSession() is called again (used while switching projects). */
export function flushAndPauseSession() {
  saveSessionNow();
  activeRootId = null;
}

export function saveSessionNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!activeRootId) return;

  const all = readAll();
  all.sessions[activeRootId] = buildSnapshot();
  all.lastRoot = activeRootId;
  writeAll(all);
}

/** Debounced save; cheap enough to call on every cursor move / scroll. */
export function scheduleSessionSave() {
  if (!activeRootId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSessionNow, SAVE_DELAY);
}

/**
 * Declares which project the open tabs belong to and turns saving on.
 * Call it once the project is shown and its saved tabs (if any) were
 * restored. If a previous project was active, its pending changes are
 * flushed first so they land under the right project.
 */
export function beginSession(rootId) {
  if (activeRootId && activeRootId !== rootId) saveSessionNow();
  activeRootId = rootId;

  if (!flushListenersAttached) {
    flushListenersAttached = true;
    // pagehide/visibilitychange are the reliable "last chance" events
    // (beforeunload isn't fired on mobile when the tab is discarded).
    window.addEventListener('pagehide', saveSessionNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveSessionNow();
    });
  }
  scheduleSessionSave();
}

/** Root id of the project that was in use when the session was last saved. */
export function getLastRootId() {
  const last = readAll().lastRoot;
  return typeof last === 'string' ? last : null;
}

export function getSavedTabCount(rootId) {
  const saved = readAll().sessions[rootId];
  return saved && Array.isArray(saved.tabs) ? saved.tabs.length : 0;
}

// ---------------- Restoring ----------------

async function resolveRealFileHandle(path) {
  const parts = normalizePath(path).split('/').filter(Boolean);
  if (!parts.length) throw new Error('empty path');
  let dir = AppState.rootDirHandle;
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
  return dir.getFileHandle(parts[parts.length - 1]);
}

/**
 * Re-opens the tabs saved for `rootId` in their original order, puts
 * every tab's cursor/scroll back, and activates the tab that was
 * active. Files that no longer exist are skipped silently.
 *
 * The editor functions are passed in (instead of imported) to keep
 * this module free of import cycles with editor.js / explorer.js.
 *
 * @returns {Promise<number>} how many tabs were restored
 */
export async function restoreSession(rootId, { openRealFile, openFileInEditor, activateTab }) {
  const saved = readAll().sessions[rootId];
  if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return 0;

  const restored = [];

  for (const tab of saved.tabs) {
    if (!tab || typeof tab.path !== 'string') continue;
    const path = normalizePath(tab.path);

    try {
      if (AppState.isRealFS) {
        const handle = await resolveRealFileHandle(path);
        await openRealFile(handle, path, handle.name, { activate: false });
      } else {
        const node = findFileByPath(AppState.fileSystem, path);
        if (!node || isImageExtension(node.name)) continue;
        if (!(await ensureNodeContent(node))) continue; // GitHub file: download it now
        openFileInEditor({
          path: node.path, name: node.name, content: node.content ?? '',
          language: getLanguageFromExtension(node.name), handle: null, isVirtual: true,
          activate: false,
        });
      }

      const file = getOpenFile(path);
      if (!file) continue; // e.g. permission denied: openRealFile already told the user
      if (tab.viewState && !file.isImage) file.viewState = tab.viewState;
      restored.push(path);
    } catch (err) {
      // NotFoundError = the file was deleted/renamed since last time.
      if (err && err.name !== 'NotFoundError') console.warn(`Could not restore the tab "${path}":`, err);
    }
  }

  if (!restored.length) return 0;

  const wanted = typeof saved.active === 'string' ? normalizePath(saved.active) : null;
  activateTab(wanted && restored.includes(wanted) ? wanted : restored[restored.length - 1]);
  return restored.length;
}

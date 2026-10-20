// ============================================================
// keybindings.js - Central registry of Zern commands and their
// keyboard shortcuts.
//
//  - Every command is defined once (id, label, default key, run).
//  - The user's changes are stored in AppState.config.keybindings
//    ({ commandId: "Ctrl+K" | null }), the same object settings.json
//    edits, so there is a single source of truth.
//  - A single keydown listener runs the "global" commands (the ones
//    that must also work when the editor does not have focus).
//  - Monaco actions are re-bound by editor.js when a shortcut changes.
//
// Combos look like "Ctrl+Shift+X", "Alt+Up" or "F12". On macOS the
// Command key counts as Ctrl.
// ============================================================
import { AppState, saveConfig } from './state.js';

const defs = new Map();       // id -> { id, label, key, run, global, when }
const listeners = new Set();
let recording = false;

const NAME_BY_CODE = {
  Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backquote: '`', Minus: '-', Equal: '=', Backslash: '\\', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter',
  Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};
const MONACO_CODE = { '/': 'Slash', ',': 'Comma', '.': 'Period', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '`': 'Backquote', '-': 'Minus', '=': 'Equal', '\\': 'Backslash', Space: 'Space', Enter: 'Enter', Esc: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Up: 'UpArrow', Down: 'DownArrow', Left: 'LeftArrow', Right: 'RightArrow' };

// Combos the editor itself (Monaco / the browser) already uses: binding them would be silently ignored or break editing.
const RESERVED = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+A', 'Ctrl+F', 'Ctrl+H', 'Ctrl+D', 'Ctrl+G', 'Ctrl+L', 'Ctrl+K', 'Ctrl+/', 'Ctrl+Space', 'Ctrl+Shift+K', 'Ctrl+Shift+O', 'Ctrl+Enter', 'Ctrl+Shift+Enter', 'Ctrl+Backspace', 'Ctrl+Delete', 'Ctrl+Home', 'Ctrl+End', 'Alt+Up', 'Alt+Down', 'Alt+Shift+Up', 'Alt+Shift+Down', 'Shift+Alt+F', 'Alt+Shift+F', 'F1', 'F2', 'F3', 'F8', 'F12', 'Tab', 'Esc', 'Enter', 'Backspace', 'Delete', 'Ctrl+Tab', 'Ctrl+R', 'Ctrl+N', 'Ctrl+T']);

// ---------------- combo helpers ----------------
export function normalizeCombo(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  const parts = str.split('+').map((p) => p.trim()).filter(Boolean);
  let ctrl = false, alt = false, shift = false, key = null;
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'ctrl' || l === 'cmd' || l === 'meta' || l === 'control') ctrl = true;
    else if (l === 'alt' || l === 'option') alt = true;
    else if (l === 'shift') shift = true;
    else if (key === null) key = p;
    else return null;
  }
  if (key === null) return null;
  const l = key.toLowerCase();
  const named = { esc: 'Esc', escape: 'Esc', enter: 'Enter', return: 'Enter', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', up: 'Up', arrowup: 'Up', down: 'Down', arrowdown: 'Down', left: 'Left', arrowleft: 'Left', right: 'Right', arrowright: 'Right' };
  if (named[l]) key = named[l];
  else if (/^f([1-9]|1[0-2])$/.test(l)) key = l.toUpperCase();
  else if (key.length === 1) key = /[a-z]/i.test(key) ? key.toUpperCase() : key;
  else return null;
  return [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift', key].filter(Boolean).join('+');
}

export function eventToCombo(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
  let key;
  if (/^[a-z0-9]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (NAME_BY_CODE[e.code]) key = NAME_BY_CODE[e.code];
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else return null;
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
}

/** A usable shortcut has Ctrl or Alt, or is a function key; bare letters would break typing. */
export function isValidBinding(combo) {
  const c = normalizeCombo(combo);
  return !!c && (/^(.*\+)?F([1-9]|1[0-2])$/.test(c) || c.startsWith('Ctrl+') || c.startsWith('Alt+') || c.startsWith('Ctrl+Alt+'));
}
export const isReserved = (combo) => RESERVED.has(normalizeCombo(combo));

/** Converts a combo to a Monaco keybinding number (or null if it can't be expressed). */
export function toMonacoKeybinding(ns, combo) {
  const c = normalizeCombo(combo);
  if (!c) return null;
  const parts = c.split('+');
  const key = parts.pop();
  let mod = 0;
  for (const p of parts) mod |= p === 'Ctrl' ? ns.KeyMod.CtrlCmd : p === 'Alt' ? ns.KeyMod.Alt : ns.KeyMod.Shift;
  let name;
  if (/^[A-Z]$/.test(key)) name = `Key${key}`;
  else if (/^[0-9]$/.test(key)) name = `Digit${key}`;
  else if (/^F([1-9]|1[0-2])$/.test(key)) name = key;
  else name = MONACO_CODE[key];
  const code = name ? ns.KeyCode[name] : undefined;
  return code != null ? (mod | code) : null;
}

// ---------------- registry ----------------
export function defineCommand(id, { label = id, key = null, run, global = false, when = null } = {}) {
  defs.set(id, { id, label, key: normalizeCombo(key), run, global, when });
}
export function undefineCommand(id) { defs.delete(id); }
/** Runs a registered command by id (used by the fallback command palette). */
export function runCommand(id) {
  const d = defs.get(id);
  if (!d || !d.run || (d.when && !d.when())) return false;
  d.run();
  return true;
}

const overrides = () => (AppState.config.keybindings && typeof AppState.config.keybindings === 'object') ? AppState.config.keybindings : {};
export const getDefaultKey = (id) => (defs.get(id) ? defs.get(id).key : null);
export function getKey(id) {
  const o = overrides();
  if (id in o) return normalizeCombo(o[id]);   // null = unbound on purpose
  return getDefaultKey(id);
}
export const isModified = (id) => id in overrides();

const emit = (id) => listeners.forEach((f) => { try { f(id); } catch (e) { console.error(e); } });
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function setKey(id, combo) {
  const next = { ...overrides() };
  const c = combo == null ? null : normalizeCombo(combo);
  if (c === getDefaultKey(id)) delete next[id]; else next[id] = c;
  AppState.config.keybindings = next;
  saveConfig(); emit(id);
}
export function resetKey(id) {
  const next = { ...overrides() }; delete next[id];
  AppState.config.keybindings = next; saveConfig(); emit(id);
}
export function resetAll() { AppState.config.keybindings = {}; saveConfig(); emit(null); }
/** Replaces every override at once (settings.json). Values must already be validated. */
export function replaceOverrides(obj) {
  const clean = {};
  for (const [id, v] of Object.entries(obj || {})) clean[id] = v == null ? null : normalizeCombo(v);
  AppState.config.keybindings = clean; saveConfig(); emit(null);
}

export function listCommands() {
  return [...defs.values()].sort((a, b) => a.label.localeCompare(b.label)).map((d) => ({
    id: d.id, label: d.label, defaultKey: d.key, key: getKey(d.id), modified: isModified(d.id),
  }));
}
export function findConflict(combo, exceptId) {
  const c = normalizeCombo(combo);
  if (!c) return null;
  for (const d of defs.values()) if (d.id !== exceptId && getKey(d.id) === c) return d;
  return null;
}

export const setRecording = (on) => { recording = !!on; };

/** One document-level listener runs every "global" command. Monaco handles its own keys first (it stops the event). */
export function initKeybindings() {
  document.addEventListener('keydown', (e) => {
    if (recording || e.defaultPrevented) return;
    const combo = eventToCombo(e);
    if (!combo) return;
    for (const d of defs.values()) {
      if (!d.global || !d.run || getKey(d.id) !== combo) continue;
      if (d.when && !d.when()) return;
      e.preventDefault();
      try { d.run(); } catch (err) { console.error(`[keybindings] ${d.id} failed`, err); }
      return;
    }
  });
}

// ============================================================
// manager.js - Extension catalog, install state and lifecycle.
//
// Only extensions listed in extensions/registry.json exist, and every
// one of them is published and reviewed by the Zern team (that is what
// the verified badge means). "Installing" persists the choice and
// activates the extension; uninstalling deactivates it and releases
// everything it registered.
// ============================================================
import { registerAppAction } from '../editor.js';
import { showToast } from '../notifications.js';
import { createApi } from './api.js';
import { registerExplorerItem } from './menus.js';
import * as settings from './settings.js';
import { activePath } from './workspace.js';

const KEY = 'zern_extensions_v1';
const catalog = new Map();   // id -> manifest + { dir, verified, baseUrl }
const running = new Map();   // id -> { mod, ctx }
const routes = new Map();    // token -> { ext, handler }  (virtual HTTP served via the service worker)
const listeners = new Set();
const docs = new Map();      // `${id}:${kind}` -> text
// Extensions that no longer ship with Zern: their leftovers are cleaned up on startup.
const RETIRED = ['zern.emmet'];
const prompted = new Set();  // extensions already recommended in this session

let state = readState();
let routingWired = false;

function readState() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.installed) return s; } catch { /* first run */ }
  return { installed: {}, dismissed: {} };
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } };
const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
const root = (dir) => new URL(`../../extensions/${dir}/`, import.meta.url);

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const list = () => [...catalog.values()];
export const get = (id) => catalog.get(id);
export const isInstalled = (id) => !!state.installed[id];
export const isEnabled = (id) => !!(state.installed[id] && state.installed[id].enabled);
export const hasUpdateNotice = (id) => !!(state.installed[id] && state.installed[id].updatedFrom);
export const updatedFrom = (id) => (state.installed[id] && state.installed[id].updatedFrom) || null;
export function dismissUpdate(id) { if (hasUpdateNotice(id)) { delete state.installed[id].updatedFrom; save(); emit(); } }

// Settings declared in each manifest (contributes.settings)
export const getSetting = (id, key) => settings.getSetting(catalog.get(id), key);
export const setSetting = (id, key, value) => settings.setSetting(catalog.get(id), key, value);
export const resetSetting = (id, key) => settings.resetSetting(catalog.get(id), key);
export const isSettingModified = (id, key) => settings.isModified(catalog.get(id), key);

async function loadFromJson() {
  const reg = await (await fetch(new URL('../../extensions/registry.json', import.meta.url), { cache: 'no-cache' })).json();
  for (const entry of reg.extensions || []) {
    try {
      const base = root(entry.dir);
      const m = await (await fetch(new URL('zern-extension.json', base), { cache: 'no-cache' })).json();
      catalog.set(m.id, { ...m, dir: entry.dir, verified: !!entry.verified, baseUrl: base.href });
    } catch (e) { console.warn('[extensions] could not load', entry.dir, e); }
  }
}

// Desktop app (file://): fetch() on local files is unreliable, so read the bundled module (npm run catalog)
async function loadFromBundle() {
  const data = (await import('../../extensions/catalog.js')).default;
  for (const entry of data.registry.extensions || []) {
    const m = data.manifests[entry.dir];
    if (!m) continue;
    catalog.set(m.id, { ...m, dir: entry.dir, verified: !!entry.verified, baseUrl: root(entry.dir).href });
    docs.set(`${m.id}:readme`, data.docs[entry.dir].readme);
    docs.set(`${m.id}:changelog`, data.docs[entry.dir].changelog);
  }
}

/** source: 'json' | 'bundle' (default: bundle on file://, JSON elsewhere; the other one is the fallback) */
export async function loadCatalog({ source } = {}) {
  catalog.clear(); docs.clear();
  const order = (source || (location.protocol === 'file:' ? 'bundle' : 'json')) === 'bundle' ? [loadFromBundle, loadFromJson] : [loadFromJson, loadFromBundle];
  for (const load of order) {
    try { await load(); if (catalog.size) break; } catch (e) { console.warn('[extensions] catalog source failed', e); }
  }
  emit();
}

export async function readDoc(id, kind) {
  const ext = catalog.get(id);
  if (!ext || !ext[kind]) return null;
  const key = `${id}:${kind}`;
  if (docs.has(key)) return docs.get(key);
  try {
    const res = await fetch(new URL(ext[kind], ext.baseUrl));
    const text = res.ok ? await res.text() : null;
    docs.set(key, text);
    return text;
  } catch { return null; }
}

// The service worker forwards requests under /__zern_ext__/<ext>/<token>/ to the window that owns the route.
function wireRouting() {
  if (routingWired || !('serviceWorker' in navigator)) return;
  routingWired = true;
  navigator.serviceWorker.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.type !== 'zern-ext-fetch') return;
    const port = e.ports[0];
    const route = routes.get(m.token);
    if (!route || route.ext !== m.ext) { port.postMessage({ ok: false }); return; }
    try {
      const r = await route.handler({ path: m.path, search: m.search, method: m.method });
      port.postMessage({ ok: true, status: r.status, headers: r.headers, body: r.body }, r.body instanceof ArrayBuffer ? [r.body] : []);
    } catch (err) {
      port.postMessage({ ok: true, status: 500, headers: { 'Content-Type': 'text/plain' }, body: new TextEncoder().encode(String(err)).buffer });
    }
  });
}

async function start(id) {
  const ext = catalog.get(id);
  if (!ext || running.has(id)) return;
  wireRouting();
  const ctx = createApi(ext, routes);
  try {
    const mod = await import(new URL(ext.main, ext.baseUrl).href);
    mod.activate(ctx.api);
    const menus = (ext.contributes && ext.contributes.menus) || {};
    const editorMenu = new Map((menus['editor/context'] || []).map((m) => [m.command, m]));
    const commands = (ext.contributes && ext.contributes.commands) || [];
    commands.forEach((c, i) => {
      const inMenu = editorMenu.get(c.command);
      ctx.subscriptions.push(registerAppAction({
        id: `ext.${c.command}`, label: c.title, keybinding: c.keybinding, global: true,
        contextMenu: inMenu ? { group: '9_zern', order: i + 1, when: inMenu.when } : undefined,
        run: () => { const h = ctx.handlers.get(c.command); h ? h() : showToast({ type: 'warning', message: `"${c.title}" is not available.` }); },
      }));
    });
    for (const m of menus['explorer/context'] || []) {
      const c = commands.find((x) => x.command === m.command);
      ctx.subscriptions.push(registerExplorerItem({
        label: c ? c.title : m.command, when: m.when, icon: m.icon,
        run: (arg) => { const h = ctx.handlers.get(m.command); if (h) h(arg); },
      }));
    }
    running.set(id, { mod, ctx });
  } catch (err) {
    console.error(`[extensions] ${id} failed to activate`, err);
    ctx.dispose();
    showToast({ type: 'error', message: `"${ext.displayName}" failed to activate: ${err.message}` });
  }
}

async function stop(id) {
  const r = running.get(id);
  if (!r) return;
  try { if (r.mod.deactivate) await r.mod.deactivate(); } catch (e) { console.warn('[extensions] deactivate failed', e); }
  r.ctx.dispose();
  running.delete(id);
}

export async function install(id) {
  const ext = catalog.get(id);
  if (!ext || isInstalled(id)) return;
  state.installed[id] = { version: ext.version, enabled: true, installedAt: Date.now() };
  save();
  await start(id);
  emit();
  showToast({ type: 'success', message: `"${ext.displayName}" installed.` });
}

export async function uninstall(id) {
  const ext = catalog.get(id);
  if (!isInstalled(id)) return;
  await stop(id);
  delete state.installed[id];
  save();
  emit();
  showToast({ type: 'info', message: `"${ext ? ext.displayName : id}" uninstalled.` });
}

export async function setEnabled(id, on) {
  const ext = catalog.get(id);
  if (!isInstalled(id) || isEnabled(id) === on) return;
  state.installed[id].enabled = on;
  save();
  on ? await start(id) : await stop(id);
  emit();
  showToast({ type: 'info', message: `"${ext.displayName}" ${on ? 'enabled' : 'disabled'}.` });
}

// Suggests an extension when a file it is made for is opened (once per session; "Don't show again" is remembered).
function checkRecommendations() {
  const p = activePath();
  if (!p) return;
  const fileExt = (p.split('.').pop() || '').toLowerCase();
  for (const e of catalog.values()) {
    const rec = e.recommend;
    if (!rec || !(rec.fileExtensions || []).includes(fileExt)) continue;
    if (isInstalled(e.id) || prompted.has(e.id) || (state.dismissed && state.dismissed[e.id])) continue;
    prompted.add(e.id);
    showToast({
      type: 'info', title: e.displayName, message: rec.message || `Install ${e.displayName}?`, timeout: 15000,
      actionLabel: 'Install', onAction: () => install(e.id),
      secondaryLabel: "Don't show again", onSecondary: () => { state.dismissed = { ...state.dismissed, [e.id]: true }; save(); },
    });
    return; // one suggestion at a time
  }
}

/** Activates every installed and enabled extension (called once at startup). */
export async function startInstalled() {
  await loadCatalog();
  const retired = RETIRED.filter((id) => state.installed[id] || (state.dismissed && state.dismissed[id]));
  if (retired.length) { retired.forEach((id) => { delete state.installed[id]; if (state.dismissed) delete state.dismissed[id]; }); save(); }
  try { const all = JSON.parse(localStorage.getItem('zern_ext_settings_v1')) || {}; if (RETIRED.some((id) => id in all)) { RETIRED.forEach((id) => delete all[id]); localStorage.setItem('zern_ext_settings_v1', JSON.stringify(all)); } } catch { /* nothing to clean */ }
  const updated = [];
  for (const id of Object.keys(state.installed)) {
    const ext = catalog.get(id);
    if (!ext) continue; // no longer published
    const entry = state.installed[id];
    if (entry.version !== ext.version) { // extensions ship with the app, so they update with it
      entry.updatedFrom = entry.version; entry.version = ext.version; save(); updated.push(ext);
    }
    if (entry.enabled) await start(id);
  }
  emit();
  updated.forEach((ext) => showToast({
    type: 'info', title: 'Extension updated', message: `"${ext.displayName}" is now v${ext.version}.`, timeout: 8000,
    actionLabel: "See what's new", onAction: () => document.dispatchEvent(new CustomEvent('zern:ext-open', { detail: { id: ext.id, tab: 'changelog' } })),
  }));
  document.addEventListener('zern:tabs-changed', checkRecommendations);
  checkRecommendations();
}

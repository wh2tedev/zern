// ============================================================
// api.js - Builds the `zern` object an extension receives in
// activate(zern). Everything an extension registers is tracked in
// `subscriptions` and released when it is disabled or uninstalled.
// ============================================================
import { showToast } from '../notifications.js';
import { APP_VERSION } from '../version.js';
import * as workspace from './workspace.js';
import * as ui from './ui.js';
import * as hooks from './editor-hooks.js';
import { pickItem, promptText } from '../quick-pick.js';
import { getSetting } from './settings.js';
import { renderMarkdown } from './markdown.js';
import { escapeHtml } from '../escape.js';

export function createApi(ext, routes) {
  const subscriptions = [];
  const handlers = new Map();
  const track = (d) => { subscriptions.push(d); return d; };
  const listen = (evt, fn) => {
    document.addEventListener(evt, fn);
    return track({ dispose: () => document.removeEventListener(evt, fn) });
  };

  const api = {
    version: APP_VERSION,
    subscriptions,
    commands: {
      register(id, fn) { handlers.set(id, fn); return track({ dispose: () => handlers.delete(id) }); },
      execute(id) { const h = handlers.get(id); return h && h(); },
    },
    workspace: {
      kind: workspace.kind,
      activePath: workspace.activePath,
      readText: workspace.readText,
      readBytes: workspace.readBytes,
      findFiles: workspace.findFiles,
      openFile: workspace.openFile,
      trustId: workspace.trustId,
      isTrusted: workspace.isTrusted,
      requestTrust: workspace.requestTrust,
      onDidChangeContent: (fn) => listen('zern:content-changed', (e) => fn(e.detail.path)),
      onDidSave: (fn) => listen('zern:file-saved', (e) => fn(e.detail.path)),
      onDidChangeActive: (fn) => { let last = workspace.activePath(); return listen('zern:tabs-changed', () => { const p = workspace.activePath(); if (p !== last) { last = p; fn(p); } }); },
    },
    window: {
      createSidePanel: (opts) => track(ui.createSidePanel(opts)),
      createSidebarView: (opts) => track(ui.createSidebarView(opts)),
      /** items: [{ label, description?, value }] -> resolves to the chosen value, or null if dismissed */
      showQuickPick: ({ placeholder = '', items = [] } = {}) => pickItem({ placeholder, items }),
      showInputBox: ({ placeholder = '', value = '' } = {}) => promptText({ placeholder, value }),
      createStatusBarItem: (opts) => track(ui.createStatusBarItem({ ...opts, execute: (id) => api.commands.execute(id) })),
      showMessage: (type, message) => showToast({ type, message }),
    },
    serve: {
      // Virtual HTTP served by the service worker: only over http(s) with an active worker.
      available: () => location.protocol.startsWith('http') && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller,
      register(handler) {
        const token = Math.random().toString(36).slice(2, 10);
        routes.set(token, { ext: ext.id, handler });
        return track({
          baseUrl: new URL(`./__zern_ext__/${ext.id}/${token}/`, document.baseURI).href,
          dispose: () => routes.delete(token),
        });
      },
    },
    editor: {
      onDidScroll: (fn) => track(hooks.onDidScroll(fn)),
      active: hooks.activeEditorInfo,
      getDocumentText: hooks.getDocumentText,
      getSelectedText: hooks.getSelectedText,
      /** Replaces each selection with fn(text); with no selection and { wholeDocument: true }, the whole file. */
      transform: hooks.transformSelections,
      insertText: hooks.insertText,
      setText: hooks.setDocumentText,
      /** handler({ path, languageId, text }) -> new text | null, run just before a file is saved. */
      onWillSave: (handler) => track(hooks.onWillSave(handler)),
    },
    markdown: { render: renderMarkdown },
    util: { escapeHtml },
    settings: {
      get: (key) => getSetting(ext, key),
      onDidChange: (fn) => listen('zern:ext-setting', (e) => { if (e.detail.ext === ext.id) fn(e.detail.key, e.detail.value); }),
    },
    storage: {
      get(key, fallback) { try { const v = localStorage.getItem(`zern_ext_${ext.id}_${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
      set(key, value) { try { localStorage.setItem(`zern_ext_${ext.id}_${key}`, JSON.stringify(value)); } catch { /* storage full or blocked */ } },
    },
  };

  return {
    api, handlers, subscriptions,
    dispose() { subscriptions.splice(0).reverse().forEach((d) => { try { d.dispose(); } catch (e) { console.warn('[extensions] dispose failed', e); } }); },
  };
}

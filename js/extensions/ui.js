// ============================================================
// ui.js - Places extensions can contribute to: the side panel
// docked to the right of the editor and the status bar.
// ============================================================
import { AppState } from '../state.js';
import { escapeHtml as esc, cssToken } from '../escape.js';

const $ = (id) => document.getElementById(id);
const relayout = () => setTimeout(() => AppState.editorInstance && AppState.editorInstance.layout(), 30);
// "$(eye) Preview" -> zi + text
const withIcons = (t) => esc(t).replace(/\$\(([a-z0-9-]+)\)/g, '<i class="zi zi-$1"></i>');

let wired = false;
function wireResizer() {
  if (wired) return; wired = true;
  const aside = $('editor-aside'), rz = $('aside-resizer'), row = $('editor-row');
  rz.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('aside-resizing');
    const move = (ev) => {
      const r = row.getBoundingClientRect();
      aside.style.width = Math.max(280, Math.min(r.right - ev.clientX, r.width - 320)) + 'px';
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('aside-resizing'); relayout(); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

export function createSidePanel({ title = '' } = {}) {
  wireResizer();
  const aside = $('editor-aside'), rz = $('aside-resizer');
  const el = document.createElement('section');
  el.className = 'aside-panel'; el.hidden = true;
  el.innerHTML = '<header class="aside-head"><span class="aside-title"></span><button type="button" class="aside-close" title="Close"><i class="zi zi-close"></i></button></header><div class="aside-body"></div>';
  aside.appendChild(el);
  const titleEl = el.querySelector('.aside-title');
  titleEl.textContent = title;
  const hideListeners = new Set();

  const sync = () => {
    const any = !!aside.querySelector('.aside-panel:not([hidden])');
    aside.hidden = !any; rz.hidden = !any;
    relayout();
  };
  const panel = {
    el: el.querySelector('.aside-body'),
    get visible() { return !el.hidden; },
    setTitle(t) { titleEl.textContent = t; },
    show() { aside.querySelectorAll('.aside-panel').forEach((p) => { if (p !== el) p.hidden = true; }); el.hidden = false; sync(); },
    hide() { if (el.hidden) return; el.hidden = true; sync(); hideListeners.forEach((f) => f()); },
    onDidHide(fn) { hideListeners.add(fn); },
    dispose() { el.remove(); sync(); },
  };
  el.querySelector('.aside-close').addEventListener('click', () => panel.hide());
  return panel;
}

export function createStatusBarItem({ text = '', tooltip = '', command = null, alignment = 'left', execute } = {}) {
  const item = document.createElement('span');
  item.className = 'status-item'; item.hidden = true;
  item.innerHTML = withIcons(text); item.title = tooltip;
  if (command) { item.setAttribute('role', 'button'); item.tabIndex = 0; item.addEventListener('click', () => execute && execute(command)); }
  const side = document.querySelector(alignment === 'right' ? '.status-right' : '.status-left');
  alignment === 'right' ? side.insertBefore(item, side.firstChild) : side.appendChild(item);
  return {
    show() { item.hidden = false; }, hide() { item.hidden = true; },
    update({ text: t, tooltip: tt } = {}) { if (t != null) item.innerHTML = withIcons(t); if (tt != null) item.title = tt; },
    dispose() { item.remove(); },
  };
}

// ---------------- sidebar views (own icon in the activity bar) ----------------
let sidebarHost = null;
/** app.js plugs in how to show a view: { activate(viewKey, button), show(viewKey) } */
export function setSidebarHost(host) { sidebarHost = host; }

export function createSidebarView({ id, title = '', icon = 'symbol-misc', tooltip } = {}) {
  const key = `ext-${id}`;
  const bar = $('activity-bar');
  const btn = document.createElement('button');
  btn.className = 'activity-btn';
  btn.dataset.view = key;
  btn.title = tooltip || title;
  btn.innerHTML = `<i class="zi zi-${cssToken(icon)}"></i><span class="activity-badge" hidden>0</span>`;
  bar.insertBefore(btn, bar.querySelector('.activity-spacer'));
  btn.addEventListener('click', () => sidebarHost && sidebarHost.activate(key, btn));

  const view = document.createElement('div');
  view.className = 'sidebar-view';
  view.id = `view-${key}`;
  view.style.display = 'none';
  view.innerHTML = '<div class="side-bar-header"><span class="ext-view-title"></span><div class="side-bar-actions"></div></div><div class="side-bar-content ext-view-content"></div>';
  $('view-extensions').parentElement.appendChild(view);
  const titleEl = view.querySelector('.ext-view-title'), actionsEl = view.querySelector('.side-bar-actions'), badge = btn.querySelector('.activity-badge');
  titleEl.textContent = title;

  const shown = new Set();
  const onShown = (e) => { if (e.detail === key) shown.forEach((f) => f()); };
  document.addEventListener('zern:sidebar-view-shown', onShown);

  return {
    el: view.querySelector('.ext-view-content'),
    setTitle(t) { titleEl.textContent = t; },
    setBadge(n) { badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n || 0); },
    /** actions: [{ icon, title, run }] shown in the view's header */
    setActions(actions = []) {
      actionsEl.innerHTML = '';
      for (const a of actions) {
        const b = document.createElement('button');
        b.type = 'button'; b.title = a.title || ''; b.innerHTML = `<i class="zi zi-${cssToken(a.icon || 'circle-filled')}"></i>`;
        b.addEventListener('click', () => a.run());
        actionsEl.appendChild(b);
      }
    },
    show() { if (sidebarHost) sidebarHost.show(key); },
    onDidShow(fn) { shown.add(fn); },
    dispose() { document.removeEventListener('zern:sidebar-view-shown', onShown); btn.remove(); view.remove(); },
  };
}

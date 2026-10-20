// ============================================================
// view.js - Extensions side bar view (Installed / Available) and the
// details page (Details / Features / Changelog), like VS Code.
// ============================================================
import * as ext from './manager.js';
import { renderMarkdown } from './markdown.js';
import { showContextMenu } from '../context-menu.js';
import { escapeHtml as esc } from '../escape.js';

const VERIFIED_TIP = 'Verified publisher: published and reviewed by the Zern team';
const badge = (cls = '') => `<i class="zi zi-verified-filled ext-verified ${cls}" title="${VERIFIED_TIP}"></i>`;
const iconUrl = (e) => new URL(e.icon || 'icon.svg', e.baseUrl).href;

let side, page, query = '', openId = null, tab = 'details';
const collapsed = new Set();

export function initExtensionsView({ container, pageHost }) {
  side = container; page = pageHost;
  side.innerHTML = `
    <div class="side-bar-header"><span>Extensions</span>
      <div class="side-bar-actions"><button type="button" id="ext-refresh" title="Refresh"><i class="zi zi-refresh"></i></button></div></div>
    <div class="side-bar-content ext-content">
      <div class="ext-search"><input type="text" id="ext-search" placeholder="Search Extensions" autocomplete="off" spellcheck="false" aria-label="Search extensions"></div>
      <div id="ext-groups"></div>
    </div>`;
  side.querySelector('#ext-search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderList(); });
  side.querySelector('#ext-refresh').addEventListener('click', () => ext.loadCatalog());
  side.addEventListener('click', onListClick);
  side.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ext-item')) { e.preventDefault(); openPage(e.target.dataset.id); } });
  page.addEventListener('click', onPageClick);
  page.addEventListener('change', onSettingChange);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openId) closePage(); });
  document.addEventListener('zern:tabs-changed', closePage); // opening/switching a file leaves the details page
  document.addEventListener('zern:ext-open', (e) => {
    const { id, tab: t } = e.detail || {};
    if (!ext.get(id)) return;
    document.getElementById('btn-extensions')?.click();
    openPage(id); if (t) { tab = t; if (t === 'changelog') ext.dismissUpdate(id); renderPage(); }
  });
  ext.onChange(() => { renderList(); if (openId) renderPage(); });
  renderList();
}

// ---------------- list ----------------
function group(key, title, items) {
  const open = !collapsed.has(key);
  return `<section class="ext-group">
    <button type="button" class="ext-group-head" data-group="${key}" aria-expanded="${open}"><i class="zi zi-chevron-${open ? 'down' : 'right'}"></i><span>${title}</span><span class="ext-count">${items.length}</span></button>
    ${open ? `<div class="ext-items">${items.length ? items.map(itemHtml).join('') : `<p class="ext-empty">${query ? 'No extensions match your search.' : 'Nothing here yet.'}</p>`}</div>` : ''}</section>`;
}

function itemHtml(e) {
  const installed = ext.isInstalled(e.id), disabled = installed && !ext.isEnabled(e.id);
  return `<div class="ext-item${disabled ? ' is-disabled' : ''}" data-id="${esc(e.id)}" role="button" tabindex="0" aria-label="${esc(e.displayName)}">
    <img class="ext-icon" src="${esc(iconUrl(e))}" alt="" width="42" height="42">
    <div class="ext-info">
      <div class="ext-row"><span class="ext-name">${esc(e.displayName)}</span><span class="ext-ver">${esc(e.version)}</span></div>
      <div class="ext-desc">${esc(e.description)}</div>
      <div class="ext-row"><span class="ext-pub">${esc(e.publisher)}${e.verified ? badge() : ''}${disabled ? '<span class="ext-tag">Disabled</span>' : ''}${ext.hasUpdateNotice(e.id) ? '<span class="ext-tag updated">Updated</span>' : ''}</span>
        ${installed ? `<button type="button" class="ext-gear" data-act="manage" data-id="${esc(e.id)}" title="Manage"><i class="zi zi-gear"></i></button>`
                    : `<button type="button" class="ext-btn" data-act="install" data-id="${esc(e.id)}">Install</button>`}</div>
    </div></div>`;
}

function renderList() {
  if (!side) return;
  const match = (e) => !query || [e.displayName, e.description, e.publisher, ...(e.categories || [])].join(' ').toLowerCase().includes(query);
  const all = ext.list().filter(match);
  const installed = all.filter((e) => ext.isInstalled(e.id)), available = all.filter((e) => !ext.isInstalled(e.id));
  side.querySelector('#ext-groups').innerHTML = group('installed', 'INSTALLED', installed) + group('available', 'AVAILABLE', available);
}

function manageMenu(id, x, y) {
  const on = ext.isEnabled(id);
  showContextMenu(x, y, [
    { label: on ? 'Disable' : 'Enable', icon: `<i class="zi zi-${on ? 'circle-slash' : 'check'}"></i>`, action: () => ext.setEnabled(id, !on) },
    { separator: true },
    { label: 'Uninstall', danger: true, icon: '<i class="zi zi-trash"></i>', action: () => ext.uninstall(id) },
  ]);
}

function onListClick(e) {
  const g = e.target.closest('.ext-group-head');
  if (g) { collapsed.has(g.dataset.group) ? collapsed.delete(g.dataset.group) : collapsed.add(g.dataset.group); renderList(); return; }
  const act = e.target.closest('[data-act]');
  if (act) {
    e.stopPropagation();
    if (act.dataset.act === 'install') ext.install(act.dataset.id);
    if (act.dataset.act === 'manage') { const r = act.getBoundingClientRect(); manageMenu(act.dataset.id, r.left, r.bottom + 4); }
    return;
  }
  const item = e.target.closest('.ext-item');
  if (item) openPage(item.dataset.id);
}

// ---------------- details page ----------------
export function showExtension(id) { openPage(id); }

function openPage(id) { openId = id; tab = 'details'; page.classList.add('visible'); renderPage(); }
function closePage() { if (!openId) return; openId = null; page.classList.remove('visible'); page.innerHTML = ''; }

function actionsHtml(e) {
  const id = esc(e.id);
  if (!ext.isInstalled(e.id)) return `<button type="button" class="ext-btn lg" data-pact="install" data-id="${id}">Install</button>`;
  return `<button type="button" class="ext-btn lg secondary" data-pact="toggle" data-id="${id}">${ext.isEnabled(e.id) ? 'Disable' : 'Enable'}</button>
          <button type="button" class="ext-btn lg secondary" data-pact="uninstall" data-id="${id}">Uninstall</button>`;
}

const tabsFor = (e) => ['details', 'features', ...(((e.contributes && e.contributes.settings) || []).length ? ['settings'] : []), 'changelog'];

function settingControl(e, s) {
  const v = ext.getSetting(e.id, s.key), k = `data-skey="${esc(s.key)}" data-id="${esc(e.id)}" id="set-${esc(s.key)}"`;
  if (s.type === 'boolean') return `<label class="ext-check"><input type="checkbox" ${k} ${v ? 'checked' : ''}> ${esc(s.title)}</label>`;
  const head = `<label for="set-${esc(s.key)}">${esc(s.title)}</label>`;
  if (s.type === 'number') return head + `<p>${esc(s.description || '')}</p><input type="number" ${k} value="${esc(v)}"${s.min != null ? ` min="${s.min}"` : ''}${s.max != null ? ` max="${s.max}"` : ''}>`;
  if (s.type === 'enum') return head + `<p>${esc(s.description || '')}</p><select ${k}>${(s.options || []).map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  return head + `<p>${esc(s.description || '')}</p><input type="text" ${k} value="${esc(v)}">`;
}

function settingsHtml(e) {
  if (!ext.isInstalled(e.id)) return '<p class="ext-empty">Install this extension to change its settings.</p>';
  return `<h2>Settings</h2>` + e.contributes.settings.map((s) => `<div class="ext-setting">${settingControl(e, s)}${s.type === 'boolean' && s.description ? `<p>${esc(s.description)}</p>` : ''}${ext.isSettingModified(e.id, s.key) ? `<button type="button" class="ext-reset" data-pact="reset" data-id="${esc(e.id)}" data-skey="${esc(s.key)}">Reset</button>` : ''}</div>`).join('');
}

function featuresHtml(e) {
  const c = e.contributes || {};
  const cmds = c.commands || [];
  const block = (title, body) => `<h2>${title}</h2>${body}`;
  let h = '';
  if (cmds.length) h += block(`Commands (${cmds.length})`, `<table><thead><tr><th>Title</th><th>ID</th><th>Keyboard shortcut</th></tr></thead><tbody>${cmds.map((x) => `<tr><td>${esc(x.title)}</td><td><code>${esc(x.command)}</code></td><td>${x.keybinding ? `<kbd>${esc(x.keybinding)}</kbd>` : ''}</td></tr>`).join('')}</tbody></table>`);
  const menuRows = [['editor/context', 'Editor right-click menu'], ['explorer/context', 'Explorer right-click menu']]
    .filter(([k]) => ((c.menus || {})[k] || []).length)
    .map(([k, label]) => `<li><strong>${label}</strong>: ${c.menus[k].map((m) => esc((cmds.find((x) => x.command === m.command) || {}).title || m.command)).join(', ')}</li>`);
  if (menuRows.length) h += block('Menus', `<ul>${menuRows.join('')}</ul>`);
  if ((c.views || []).length) h += block('Sidebar views', `<ul>${c.views.map((x) => `<li><strong>${esc(x.title)}</strong>: ${esc(x.description || '')}</li>`).join('')}</ul>`);
  if ((c.settings || []).length) h += block(`Settings (${c.settings.length})`, `<ul>${c.settings.map((x) => `<li><strong>${esc(x.title)}</strong>: ${esc(x.description || '')}</li>`).join('')}</ul>`);
  if ((c.statusBar || []).length) h += block('Status bar', `<ul>${c.statusBar.map((x) => `<li><strong>${esc(x.text)}</strong>: ${esc(x.tooltip || '')}</li>`).join('')}</ul>`);
  if ((c.sidePanels || []).length) h += block('Side panels', `<ul>${c.sidePanels.map((x) => `<li><strong>${esc(x.title)}</strong>: ${esc(x.description || '')}</li>`).join('')}</ul>`);
  return h || '<p>This extension does not declare any features.</p>';
}

async function renderPage() {
  const e = ext.get(openId);
  if (!e) { closePage(); return; }
  const installed = ext.isInstalled(e.id), enabled = ext.isEnabled(e.id);
  const state = !installed ? '' : enabled ? 'This extension is enabled.' : 'This extension is disabled.';
  const scroll = (page.querySelector('.ext-page-scroll') || {}).scrollTop || 0;
  page.innerHTML = `
    <div class="ext-page-tab"><span class="ext-page-tabitem"><i class="zi zi-extensions"></i> Extension: ${esc(e.displayName)}
      <button type="button" data-pact="close" title="Close (Esc)" aria-label="Close"><i class="zi zi-close"></i></button></span></div>
    <div class="ext-page-scroll">
      <header class="ext-hero">
        <img class="ext-hero-icon" src="${esc(iconUrl(e))}" alt="" width="128" height="128">
        <div class="ext-hero-main">
          <h1>${esc(e.displayName)} <span class="ext-hero-ver">v${esc(e.version)}</span></h1>
          <div class="ext-hero-meta"><span>${esc(e.publisher)}${e.verified ? badge('lg') : ''}${e.verified ? ' <em>Verified publisher</em>' : ''}</span></div>
          <p class="ext-hero-desc">${esc(e.description)}</p>
          <div class="ext-hero-actions">${actionsHtml(e)}</div>
          ${state ? `<p class="ext-state">${state}</p>` : ''}
        </div>
      </header>
      ${ext.hasUpdateNotice(e.id) ? `<div class="ext-notice"><span>Updated from v${esc(ext.updatedFrom(e.id))} to v${esc(e.version)}. <a data-pact="tab" data-tab="changelog">See what's new</a></span><button type="button" data-pact="dismiss">Dismiss</button></div>` : ''}
      <nav class="ext-tabs" role="tablist">${tabsFor(e).map((t) => `<button type="button" role="tab" class="${t === tab ? 'active' : ''}" aria-selected="${t === tab}" data-pact="tab" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</nav>
      <div class="ext-cols">
        <div class="ext-doc md" id="ext-doc"><p class="ext-empty">Loading…</p></div>
        <aside class="ext-side">
          <h3>Installation</h3><dl><dt>Identifier</dt><dd><code>${esc(e.id)}</code></dd><dt>Version</dt><dd>${esc(e.version)}</dd><dt>Status</dt><dd>${installed ? (enabled ? 'Installed' : 'Installed (disabled)') : 'Not installed'}</dd></dl>
          <h3>Marketplace</h3><dl><dt>Publisher</dt><dd>${esc(e.publisher)}${e.verified ? badge() : ''}</dd></dl>
          <h3>Categories</h3><div class="ext-chips">${(e.categories || []).map((c) => `<span>${esc(c)}</span>`).join('')}</div>
        </aside>
      </div>
    </div>`;
  const doc = page.querySelector('#ext-doc');
  if (tab === 'features') doc.innerHTML = featuresHtml(e);
  else if (tab === 'settings') doc.innerHTML = settingsHtml(e);
  else {
    const text = await ext.readDoc(e.id, tab === 'changelog' ? 'changelog' : 'readme');
    if (openId !== e.id) return;
    doc.innerHTML = text ? renderMarkdown(text, e.baseUrl) : '<p class="ext-empty">No content available.</p>';
  }
  const sc = page.querySelector('.ext-page-scroll'); if (sc) sc.scrollTop = scroll;
}

function onPageClick(ev) {
  const b = ev.target.closest('[data-pact]');
  if (!b) return;
  const id = b.dataset.id || openId;
  switch (b.dataset.pact) {
    case 'close': closePage(); break;
    case 'install': ext.install(id); break;
    case 'uninstall': ext.uninstall(id); break;
    case 'toggle': ext.setEnabled(id, !ext.isEnabled(id)); break;
    case 'tab': tab = b.dataset.tab; if (tab === 'changelog') ext.dismissUpdate(id); renderPage(); break;
    case 'dismiss': ext.dismissUpdate(id); break;
    case 'reset': ext.resetSetting(id, b.dataset.skey); renderPage(); break;
  }
}

function onSettingChange(ev) {
  const t = ev.target;
  if (!t.dataset || !t.dataset.skey) return;
  ext.setSetting(t.dataset.id, t.dataset.skey, t.type === 'checkbox' ? t.checked : t.value);
  renderPage(); // refreshes the Reset links and shows the value after validation
}

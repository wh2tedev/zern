// ============================================================
// problems.js - VS Code-style "Problems" panel.
//
// Monaco already computes errors/warnings for every open file (its
// "markers"). This module only gathers them, shows them in a bottom
// panel grouped by file, and mirrors them as:
//   - the error/warning counters in the status bar
//   - red / yellow file names (+ count) in the Explorer
//   - red / yellow names on tabs
// Only files that are OPEN in a tab have markers, so the panel covers
// the open files (VS Code can analyze a whole project; Monaco can't).
// ============================================================

import { AppState } from './state.js';
import { getFileIcon } from './icons.js';
import { goToProblem } from './editor.js';
import { setProblemDecorations } from './explorer.js';
import { escapeHtml, cssToken } from './escape.js';

const STORE_KEY = 'zern_panel_v1';
const MIN_HEIGHT = 90;
const RANK = { error: 0, warning: 1, info: 2 };

let monacoNS = null;
let timer = null;
let result = { files: [], counts: { error: 0, warning: 0, info: 0 } };

const view = {
  open: false,
  height: 240,
  filter: '',
  show: { error: true, warning: true, info: true },
  collapsed: new Set(),
};

// ---------------- Persistence ----------------

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) {
      view.open = !!saved.open;
      if (Number.isFinite(saved.height)) view.height = saved.height;
    }
  } catch { /* defaults */ }
}
function savePrefs() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ open: view.open, height: view.height })); } catch { /* ignore */ }
}

// ---------------- Collecting ----------------

// Monaco's MarkerSeverity: Hint = 1, Info = 2, Warning = 4, Error = 8. Hints (e.g. "unused variable"
// faded text) are not problems, as in VS Code.
const severityOf = (s) => (s >= 8 ? 'error' : s >= 4 ? 'warning' : s >= 2 ? 'info' : null);

function codeText(m) {
  const code = m.code && typeof m.code === 'object' ? m.code.value : m.code;
  if (code === undefined || code === null || code === '') return m.source || '';
  return m.source ? `${m.source}(${code})` : String(code);
}

/** Reads every marker of the open files. Exported for tests. */
export function collectProblems() {
  const counts = { error: 0, warning: 0, info: 0 };
  const byPath = new Map();
  if (!monacoNS) return { files: [], counts };

  for (const m of monacoNS.editor.getModelMarkers({})) {
    const kind = severityOf(m.severity);
    if (!kind) continue;
    const uri = m.resource;
    if (uri && uri.scheme && uri.scheme !== 'file') continue; // diff baselines etc.
    const path = uri && uri.path;
    const open = path && AppState.openFiles.get(path);
    if (!open || open.isDiff) continue;

    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push({
      kind, message: m.message || '', source: codeText(m),
      startLineNumber: m.startLineNumber, startColumn: m.startColumn,
      endLineNumber: m.endLineNumber, endColumn: m.endColumn,
    });
    counts[kind]++;
  }

  const files = [...byPath.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }))
    .map(([path, markers]) => ({
      path,
      markers: markers.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn),
    }));
  return { files, counts };
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 150); // typing re-validates constantly: don't redraw on every marker batch
}

export function refresh() {
  clearTimeout(timer);
  result = collectProblems();
  renderStatus();
  renderPanel();
  applyTabMarks();
  setProblemDecorations(result.files);
  document.dispatchEvent(new CustomEvent('zern:problems-changed', { detail: result }));
}

// ---------------- Rendering ----------------

const $ = (id) => document.getElementById(id);
function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const sevIcon = (kind) => `<i class="zi zi-${cssToken(kind)} sev-${cssToken(kind)}"></i>`;

function renderStatus() {
  const item = $('status-problems');
  if (!item) return;
  const { error, warning } = result.counts;
  item.innerHTML = `<i class="zi zi-error"></i> ${error} <i class="zi zi-warning"></i> ${warning}`;
  item.title = `${error} error${error === 1 ? '' : 's'}, ${warning} warning${warning === 1 ? '' : 's'} in the open files. Click to show the Problems panel.`;
}

function matches(file, m) {
  if (!view.show[m.kind]) return false;
  const q = view.filter.trim().toLowerCase();
  if (!q) return true;
  return `${m.message} ${m.source} ${file.path}`.toLowerCase().includes(q);
}

function renderPanel() {
  const list = $('problems-list');
  if (!list) return;
  const { error, warning, info } = result.counts;
  $('problems-badge').textContent = String(error + warning + info);
  $('count-error').textContent = String(error);
  $('count-warning').textContent = String(warning);
  $('count-info').textContent = String(info);

  const scrollTop = list.scrollTop;
  list.innerHTML = '';

  if (!result.files.length) {
    list.appendChild(el('div', 'problems-empty', 'No problems have been detected in the open files.'));
    return;
  }

  let shownAny = false;
  for (const file of result.files) {
    const rows = file.markers.filter((m) => matches(file, m));
    if (!rows.length) continue;
    shownAny = true;

    const name = file.path.split('/').pop();
    const dir = file.path.slice(1, file.path.length - name.length - 1);
    const collapsed = view.collapsed.has(file.path);

    const head = el('div', 'problems-file');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.innerHTML = `<i class="zi zi-chevron-${collapsed ? 'right' : 'down'}"></i>
      <span class="problems-file-icon">${getFileIcon(name)}</span>
      <span class="problems-file-name">${escapeHtml(name)}</span>
      <span class="problems-file-dir">${escapeHtml(dir)}</span>
      <span class="problems-count">${rows.length}</span>`;
    const toggle = () => { collapsed ? view.collapsed.delete(file.path) : view.collapsed.add(file.path); renderPanel(); };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    list.appendChild(head);
    if (collapsed) continue;

    for (const m of rows) {
      const row = el('div', 'problems-row');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const firstLine = m.message.split('\n')[0];
      row.title = m.message;
      row.innerHTML = `${sevIcon(m.kind)}
        <span class="problems-msg">${escapeHtml(firstLine)}</span>
        ${m.source ? `<span class="problems-src">${escapeHtml(m.source)}</span>` : ''}
        <span class="problems-pos">[Ln ${m.startLineNumber}, Col ${m.startColumn}]</span>`;
      const go = () => goToProblem(file.path, m);
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      list.appendChild(row);
    }
  }
  if (!shownAny) list.appendChild(el('div', 'problems-empty', 'No results found with the provided filter criteria.'));
  list.scrollTop = scrollTop;
}

// Tabs of files with errors/warnings get the same colored name as in VS Code
function applyTabMarks() {
  const tabs = document.getElementById('tabs-bar');
  if (!tabs) return;
  const status = new Map(result.files.map((f) => [f.path, f.markers.some((m) => m.kind === 'error') ? 'error' : f.markers.some((m) => m.kind === 'warning') ? 'warning' : null]));
  tabs.querySelectorAll('.editor-tab').forEach((tab) => {
    const s = status.get(tab.dataset.path) || null;
    tab.classList.toggle('problem-error', s === 'error');
    tab.classList.toggle('problem-warning', s === 'warning');
  });
}

// ---------------- Panel open / close / resize ----------------

function applyLayout() {
  const panel = $('bottom-panel');
  if (!panel) return;
  panel.hidden = !view.open;
  const area = panel.parentElement;
  const max = area ? Math.max(MIN_HEIGHT, area.clientHeight * 0.75) : 600;
  panel.style.height = `${Math.min(Math.max(view.height, MIN_HEIGHT), max)}px`;
  const status = $('status-problems');
  if (status) status.classList.toggle('active', view.open);
  // The editor host has no fixed size (flex), so Monaco's automaticLayout picks the change up.
}

export function toggleProblemsPanel(force) {
  view.open = force === undefined ? !view.open : !!force;
  applyLayout();
  savePrefs();
  if (view.open) renderPanel();
}

export const getProblemCounts = () => result.counts;

function wireSash() {
  const sash = $('panel-sash');
  const panel = $('bottom-panel');
  if (!sash || !panel) return;
  sash.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sash.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = panel.getBoundingClientRect().height;
    const onMove = (ev) => {
      view.height = startH + (startY - ev.clientY); // dragging up makes it taller
      applyLayout();
    };
    const onUp = () => {
      sash.removeEventListener('pointermove', onMove);
      sash.removeEventListener('pointerup', onUp);
      savePrefs();
    };
    sash.addEventListener('pointermove', onMove);
    sash.addEventListener('pointerup', onUp);
  });
}

// ---------------- Init ----------------

export function initProblems(monaco) {
  monacoNS = monaco;
  loadPrefs();

  monacoNS.editor.onDidChangeMarkers(() => schedule());
  document.addEventListener('zern:tabs-changed', schedule); // markers disappear with a closed model

  $('status-problems').addEventListener('click', () => toggleProblemsPanel());
  $('status-problems').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleProblemsPanel(); } });
  $('panel-close').addEventListener('click', () => toggleProblemsPanel(false));
  $('problems-collapse').addEventListener('click', () => {
    result.files.forEach((f) => view.collapsed.add(f.path));
    renderPanel();
  });
  $('problems-filter').addEventListener('input', (e) => { view.filter = e.target.value; renderPanel(); });
  document.querySelectorAll('.sev-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.sev;
      view.show[kind] = !view.show[kind];
      btn.classList.toggle('on', view.show[kind]);
      btn.setAttribute('aria-pressed', String(view.show[kind]));
      renderPanel();
    });
  });
  wireSash();
  window.addEventListener('resize', applyLayout);

  applyLayout();
  refresh();
}

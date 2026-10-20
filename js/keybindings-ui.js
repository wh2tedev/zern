// ============================================================
// keybindings-ui.js - "Keyboard Shortcuts" screen: search every
// command, record a new combination, reset or unassign it.
// ============================================================
import * as kb from './keybindings.js';
import { showToast } from './notifications.js';
import { escapeHtml as esc } from './escape.js';

let overlay = null, listEl = null, searchEl = null, resetAllBtn = null;
let editingId = null, captured = null, message = '', confirmReset = false;

const caps = (combo) => combo ? combo.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('') : '';
const isOpen = () => !!overlay && overlay.classList.contains('open');

function ensureDom() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'pref-overlay';
  overlay.id = 'keys-overlay';
  overlay.innerHTML = `<div class="pref-panel" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts">
    <div class="pref-head"><span>Keyboard Shortcuts</span>
      <div class="pref-head-actions">
        <button type="button" data-a="json">Edit in JSON</button>
        <button type="button" data-a="reset-all">Reset all</button>
        <button type="button" data-a="close" aria-label="Close"><i class="zi zi-close"></i></button>
      </div></div>
    <div class="pref-search"><input type="text" placeholder="Search by command or shortcut" autocomplete="off" spellcheck="false" aria-label="Search shortcuts"></div>
    <div class="pref-table-head"><span>Command</span><span>Shortcut</span><span></span></div>
    <div class="pref-list" role="list"></div>
    <div class="pref-foot">Click a shortcut to change it, press the new combination, then Enter. Esc cancels. Shortcuts need Ctrl or Alt (or a function key).</div>
  </div>`;
  document.body.appendChild(overlay);
  listEl = overlay.querySelector('.pref-list');
  searchEl = overlay.querySelector('.pref-search input');
  resetAllBtn = overlay.querySelector('[data-a="reset-all"]');
  searchEl.addEventListener('input', render);
  overlay.addEventListener('click', onClick);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen() && !editingId) close(); });
  kb.onChange(() => { if (isOpen()) render(); });
}

function render() {
  const q = (searchEl.value || '').trim().toLowerCase();
  const rows = kb.listCommands().filter((c) => !q || `${c.label} ${c.id} ${c.key || ''}`.toLowerCase().includes(q));
  listEl.innerHTML = rows.length ? rows.map((c) => {
    const editing = c.id === editingId;
    const keyCell = editing
      ? `<span class="pref-capture">${captured ? caps(captured) : 'Press the new shortcut…'}</span>`
      : (c.key ? caps(c.key) : '<span class="pref-none">Unassigned</span>');
    return `<div class="pref-row${c.modified ? ' modified' : ''}${editing ? ' editing' : ''}" role="listitem" data-id="${esc(c.id)}">
      <div class="pref-cmd"><span class="pref-label">${esc(c.label)}</span><span class="pref-id">${esc(c.id)}</span></div>
      <button type="button" class="pref-key" data-a="edit" title="Change shortcut">${keyCell}</button>
      <div class="pref-actions">
        ${c.modified ? `<button type="button" data-a="reset" title="Reset to default${c.defaultKey ? ' (' + esc(c.defaultKey) + ')' : ''}"><i class="zi zi-discard"></i></button>` : ''}
        ${c.key ? '<button type="button" data-a="clear" title="Remove shortcut"><i class="zi zi-close"></i></button>' : ''}
      </div>
      ${editing && message ? `<div class="pref-msg">${esc(message)}</div>` : ''}
    </div>`;
  }).join('') : '<p class="pref-empty">No commands match your search.</p>';
  resetAllBtn.textContent = confirmReset ? 'Click again to reset all' : 'Reset all';
}

// ---------------- recording ----------------
function onRecordKey(e) {
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { stopEditing(); return; }
  const bare = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  if (e.key === 'Enter' && bare) { confirmEdit(); return; }
  const combo = kb.eventToCombo(e);
  if (!combo) return; // only modifiers so far
  captured = combo;
  if (!kb.isValidBinding(combo)) message = 'Use Ctrl or Alt together with a key, or a function key (F1 to F12).';
  else if (kb.isReserved(combo)) message = `${combo} is used by the editor itself. Pick another one.`;
  else {
    const other = kb.findConflict(combo, editingId);
    message = other ? `Already used by "${other.label}". Remove it there first.` : 'Press Enter to assign, Esc to cancel.';
  }
  render();
}

function startEditing(id) {
  stopEditing(false);
  editingId = id; captured = null; message = 'Press the new shortcut, then Enter.';
  kb.setRecording(true);
  document.addEventListener('keydown', onRecordKey, true);
  render();
}
function stopEditing(redraw = true) {
  if (!editingId) return;
  editingId = null; captured = null; message = '';
  kb.setRecording(false);
  document.removeEventListener('keydown', onRecordKey, true);
  if (redraw) render();
}
function confirmEdit() {
  if (!captured || !kb.isValidBinding(captured) || kb.isReserved(captured) || kb.findConflict(captured, editingId)) return;
  const id = editingId, combo = captured;
  stopEditing(false);
  kb.setKey(id, combo);
  showToast({ type: 'success', message: `Shortcut set to ${combo}.`, timeout: 2200 });
}

function onClick(e) {
  if (e.target === overlay) { close(); return; }
  const btn = e.target.closest('[data-a]');
  const row = e.target.closest('.pref-row');
  if (editingId && !(row && row.dataset.id === editingId)) stopEditing(false);
  if (!btn) { render(); return; }
  const a = btn.dataset.a, id = row && row.dataset.id;
  if (a !== 'reset-all') confirmReset = false;
  if (a === 'close') close();
  else if (a === 'json') { close(); import('./settings-json.js').then((m) => m.openSettingsJson()); }
  else if (a === 'edit') startEditing(id);
  else if (a === 'reset') kb.resetKey(id);
  else if (a === 'clear') kb.setKey(id, null);
  else if (a === 'reset-all') {
    if (!confirmReset) { confirmReset = true; render(); return; }
    confirmReset = false; kb.resetAll();
    showToast({ type: 'info', message: 'All shortcuts were reset to their defaults.', timeout: 2500 });
  }
}

export function openKeyboardShortcuts() {
  ensureDom();
  confirmReset = false; searchEl.value = '';
  overlay.classList.add('open');
  render();
  searchEl.focus();
}
export function close() {
  if (!overlay) return;
  stopEditing(false); confirmReset = false;
  overlay.classList.remove('open');
}

// ============================================================
// editor-hooks.js - Editor-level hooks for extensions.
//  - scroll events (e.g. synced Markdown preview)
//  - reading and editing the active document (selection transforms)
//  - onWillSave: let extensions adjust the text right before a file is saved
// ============================================================
import { AppState } from '../state.js';

let editor = null;
const willSaveHandlers = [];

export function attachEditor(ed) {
  editor = ed;
}

/** fn receives the scroll position as a 0..1 ratio. Returns a disposable (no-op when the editor is not ready). */
export function onDidScroll(fn) {
  if (!editor) return { dispose() {} };
  return editor.onDidScrollChange(() => {
    const max = editor.getScrollHeight() - editor.getLayoutInfo().height;
    fn(max > 0 ? editor.getScrollTop() / max : 0);
  });
}

// ---------------- the active document ----------------
const model = () => (editor && AppState.activeFilePath ? editor.getModel() : null);

export function activeEditorInfo() {
  const m = model();
  return m ? { path: AppState.activeFilePath, languageId: m.getLanguageId() } : null;
}
export function getDocumentText() { const m = model(); return m ? m.getValue() : ''; }
export function getSelectedText() {
  const m = model();
  return m ? editor.getSelections().filter((s) => !s.isEmpty()).map((s) => m.getValueInRange(s)).join('\n') : '';
}

/**
 * Replaces every selection with fn(selectedText). With no selection and wholeDocument, transforms the whole file.
 * One undo step. Returns true if something was applied.
 */
export function transformSelections(fn, { wholeDocument = false } = {}) {
  const m = model();
  if (!m) return false;
  const selections = editor.getSelections().filter((s) => !s.isEmpty());
  let edits;
  if (selections.length) edits = selections.map((range) => ({ range, text: fn(m.getValueInRange(range)) }));
  else if (wholeDocument) { const range = m.getFullModelRange(); edits = [{ range, text: fn(m.getValue()) }]; }
  else return false;
  edits = edits.filter((e) => e.text !== m.getValueInRange(e.range));
  if (!edits.length) return true;
  editor.pushUndoStop();
  editor.executeEdits('zern-extension', edits);
  editor.pushUndoStop();
  return true;
}

export function insertText(text) {
  const m = model();
  if (!m) return false;
  editor.pushUndoStop();
  editor.executeEdits('zern-extension', editor.getSelections().map((range) => ({ range, text })));
  editor.pushUndoStop();
  return true;
}

/**
 * Smallest line-based edits that turn `current` into `target` (Monaco coordinates, 1-based).
 * Leading and trailing equal lines are kept untouched. Inside the changed block, lines are compared pairwise and only
 * the part of a line that changes is edited; whatever is left at the end of the block (extra lines to remove or add)
 * is handled as one last edit that also keeps the start of its first line and the end of its last line.
 * So a cursor in untouched text, or before the changed part of a line, stays exactly where it is.
 */
export function computeEdits(current, target) {
  if (current === target) return [];
  const a = current.split('\n'), b = target.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const am = a.slice(start, endA), bm = b.slice(start, endB);
  const m = am.length === bm.length ? am.length : Math.max(0, Math.min(am.length, bm.length) - 1); // lines compared one by one
  const r = (l1, c1, l2, c2) => ({ startLineNumber: l1, startColumn: c1, endLineNumber: l2, endColumn: c2 });
  const edits = [];

  for (let k = 0; k < m; k++) {
    const x = am[k], y = bm[k];
    if (x === y) continue;
    let p = 0;
    while (p < x.length && p < y.length && x[p] === y[p]) p++;
    let q = 0;
    while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
    edits.push({ range: r(start + 1 + k, p + 1, start + 1 + k, x.length - q + 1), text: y.slice(p, y.length - q) });
  }

  // the rest of the block: original lines [i0, i1) become `ys`
  const i0 = start + m, i1 = endA, ys = bm.slice(m), xs = a.slice(i0, i1);
  if (!xs.length && !ys.length) return edits;
  if (!xs.length) { // only insertions
    if (i0 < a.length) edits.push({ range: r(i0 + 1, 1, i0 + 1, 1), text: ys.join('\n') + '\n' });
    else edits.push({ range: r(a.length, a[a.length - 1].length + 1, a.length, a[a.length - 1].length + 1), text: '\n' + ys.join('\n') });
  } else if (!ys.length) { // only removals
    if (i1 < a.length) edits.push({ range: r(i0 + 1, 1, i1 + 1, 1), text: '' });
    else if (i0 > 0) edits.push({ range: r(i0, a[i0 - 1].length + 1, i1, a[i1 - 1].length + 1), text: '' });
    else edits.push({ range: r(1, 1, i1, a[i1 - 1].length + 1), text: '' });
  } else { // replacement: keep what is equal at the start of the first line and the end of the last line
    const x0 = xs[0], y0 = ys[0], xl = xs[xs.length - 1], yl = ys[ys.length - 1];
    let p = 0;
    while (p < x0.length && p < y0.length && x0[p] === y0[p]) p++;
    const maxQ = Math.min(xl.length - (xs.length === 1 ? p : 0), yl.length - (ys.length === 1 ? p : 0));
    let q = 0;
    while (q < maxQ && xl[xl.length - 1 - q] === yl[yl.length - 1 - q]) q++;
    const text = ys.length === 1 ? y0.slice(p, y0.length - q) : [y0.slice(p), ...ys.slice(1, -1), yl.slice(0, yl.length - q)].join('\n');
    edits.push({ range: r(i0 + 1, p + 1, i1, xl.length - q + 1), text });
  }
  return edits;
}

/** Makes `target` the text of `m` touching as little as possible (see computeEdits). One undo step. */
export function applyTextToModel(m, target) {
  const edits = computeEdits(m.getValue(), target);
  if (!edits.length) return false;
  m.pushStackElement();
  m.pushEditOperations([], edits, () => null);
  m.pushStackElement();
  return true;
}
export function setDocumentText(text) { const m = model(); return m ? applyTextToModel(m, text) : false; }

// ---------------- before saving ----------------
/** handler({ path, languageId, text }) -> new text | null. Handlers run in order, each seeing the previous result. */
export function onWillSave(handler) {
  willSaveHandlers.push(handler);
  return { dispose() { const i = willSaveHandlers.indexOf(handler); if (i >= 0) willSaveHandlers.splice(i, 1); } };
}
export async function runWillSave(path, fileModel) {
  if (!willSaveHandlers.length) return;
  let text = fileModel.getValue();
  for (const handler of [...willSaveHandlers]) {
    try {
      const out = await handler({ path, languageId: fileModel.getLanguageId(), text });
      if (typeof out === 'string') text = out;
    } catch (e) { console.warn('[extensions] onWillSave handler failed', e); }
  }
  applyTextToModel(fileModel, text);
}

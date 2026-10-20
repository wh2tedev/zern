// JSON Tools - first-party Zern extension. Works on the selection, or on the whole file if nothing is selected.
const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort((a, b) => a.localeCompare(b)).map((k) => [k, sortDeep(v[k])])) : v);

export function activate(zern) {
  const toast = (type, message) => zern.window.showMessage(type, message);
  const indent = () => (zern.settings.get('useTabs') ? '\t' : zern.settings.get('indent'));
  const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');

  // Applies fn(text) to the selection / whole file. fn may throw: the text is then left untouched.
  function run(label, fn) {
    if (!zern.editor.active()) { toast('info', 'Open a file first.'); return; }
    try {
      if (!zern.editor.transform(fn, { wholeDocument: true })) toast('info', 'Nothing to do.');
    } catch (e) {
      toast('error', `${label}: ${e.message}. Nothing was changed.`);
    }
  }

  zern.commands.register('jsonTools.format', () => run('Format JSON', (t) => JSON.stringify(JSON.parse(t), null, indent()).replace(/\n/g, eolOf(t)) + (/\n$/.test(t) ? eolOf(t) : '')));
  zern.commands.register('jsonTools.minify', () => run('Minify JSON', (t) => JSON.stringify(JSON.parse(t)) + (/\n$/.test(t) ? eolOf(t) : '')));
  zern.commands.register('jsonTools.sortKeys', () => run('Sort keys', (t) => JSON.stringify(sortDeep(JSON.parse(t)), null, indent()).replace(/\n/g, eolOf(t)) + (/\n$/.test(t) ? eolOf(t) : '')));
  zern.commands.register('jsonTools.escape', () => run('Escape', (t) => JSON.stringify(t)));
  zern.commands.register('jsonTools.unescape', () => run('Unescape', (t) => {
    const v = JSON.parse(/^\s*"/.test(t) ? t : `"${t}"`);
    if (typeof v !== 'string') throw new Error('that is not a JSON string');
    return v;
  }));

  zern.commands.register('jsonTools.validate', () => {
    if (!zern.editor.active()) { toast('info', 'Open a file first.'); return; }
    const text = zern.editor.getSelectedText() || zern.editor.getDocumentText();
    try { JSON.parse(text); toast('success', 'Valid JSON.'); }
    catch (e) { toast('error', `Invalid JSON: ${e.message}${/\/\/|\/\*/.test(text) ? ' (comments are not allowed in JSON)' : ''}`); }
  });
}

export function deactivate() { /* nothing to release */ }

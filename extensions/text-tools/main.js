// Text Tools - first-party Zern extension. Everything runs locally on the text you select.
const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().split(/\s+/).filter(Boolean);
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
const lines = (fn) => (s) => { const eol = s.includes('\r\n') ? '\r\n' : '\n'; return fn(s.split(/\r?\n/)).join(eol); };
const bytesToBase64 = (s) => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(bin); };

// key -> { label, description, run(text), whole? }  (whole: with no selection, work on the whole file)
const TRANSFORMS = {
  uppercase: { label: 'UPPERCASE', run: (s) => s.toUpperCase() },
  lowercase: { label: 'lowercase', run: (s) => s.toLowerCase() },
  titleCase: { label: 'Title Case', run: (s) => s.toLowerCase().replace(/(^|[\s\-_])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) },
  camelCase: { label: 'camelCase', run: (s) => words(s).map((w, i) => (i ? cap(w.toLowerCase()) : w.toLowerCase())).join('') },
  pascalCase: { label: 'PascalCase', run: (s) => words(s).map((w) => cap(w.toLowerCase())).join('') },
  snakeCase: { label: 'snake_case', run: (s) => words(s).join('_').toLowerCase() },
  kebabCase: { label: 'kebab-case', run: (s) => words(s).join('-').toLowerCase() },
  constantCase: { label: 'CONSTANT_CASE', run: (s) => words(s).join('_').toUpperCase() },
  sortAsc: { label: 'Sort lines ascending', whole: true, run: lines((l) => l.slice().sort((a, b) => a.localeCompare(b))) },
  sortDesc: { label: 'Sort lines descending', whole: true, run: lines((l) => l.slice().sort((a, b) => b.localeCompare(a))) },
  unique: { label: 'Remove duplicate lines', whole: true, run: lines((l) => l.filter((x, i) => l.indexOf(x) === i)) },
  reverse: { label: 'Reverse lines', whole: true, run: lines((l) => l.slice().reverse()) },
  trim: { label: 'Trim trailing whitespace', whole: true, run: lines((l) => l.map((x) => x.replace(/[ \t]+$/, ''))) },
  base64Encode: { label: 'Base64 encode', run: bytesToBase64 },
  base64Decode: { label: 'Base64 decode', run: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0))) },
  urlEncode: { label: 'URL encode', run: (s) => encodeURIComponent(s) },
  urlDecode: { label: 'URL decode', run: (s) => decodeURIComponent(s) },
  htmlEncode: { label: 'HTML encode (& < > " \')', run: (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) },
  htmlDecode: { label: 'HTML decode', run: (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()] || (e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10))))) },
};

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

export function activate(zern) {
  const toast = (type, message) => zern.window.showMessage(type, message);

  function apply(key) {
    const t = TRANSFORMS[key];
    if (!zern.editor.active()) { toast('info', 'Open a file first.'); return; }
    try {
      if (!zern.editor.transform(t.run, { wholeDocument: !!t.whole })) toast('info', 'Select some text first.');
    } catch {
      toast('error', `"${t.label}" could not be applied: the text is not valid for this conversion.`);
    }
  }

  const bind = (command, key) => zern.commands.register(command, () => apply(key));
  [['uppercase', 'uppercase'], ['lowercase', 'lowercase'], ['titleCase', 'titleCase'], ['sortAsc', 'sortAsc'], ['sortDesc', 'sortDesc'],
    ['unique', 'unique'], ['trim', 'trim'], ['base64Encode', 'base64Encode'], ['base64Decode', 'base64Decode'], ['urlEncode', 'urlEncode'], ['urlDecode', 'urlDecode']]
    .forEach(([c, k]) => bind('textTools.' + c, k));

  zern.commands.register('textTools.transform', async () => {
    if (!zern.editor.active()) { toast('info', 'Open a file first.'); return; }
    const key = await zern.window.showQuickPick({
      placeholder: 'Choose a transformation for the selection',
      items: Object.entries(TRANSFORMS).map(([value, t]) => ({ label: t.label, description: t.whole ? 'works on the whole file if nothing is selected' : '', value })),
    });
    if (key) apply(key);
  });

  const insert = (text) => { if (!zern.editor.insertText(text)) toast('info', 'Open a file first.'); };
  zern.commands.register('textTools.insertUuid', () => insert(uuid()));
  zern.commands.register('textTools.insertLorem', () => insert(Array.from({ length: zern.settings.get('loremParagraphs') }, () => LOREM).join('\n\n')));
  zern.commands.register('textTools.insertDate', () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const f = zern.settings.get('dateFormat');
    insert(f === 'iso' ? d.toISOString() : f === 'locale' ? d.toLocaleString() : f === 'datetime' ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  });
}

export function deactivate() { /* nothing to release */ }

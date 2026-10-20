// Markdown Tools - first-party Zern extension.
const FENCE = /^\s*(```|~~~)/;
const START = '<!-- toc -->', END = '<!-- tocstop -->';

// GitHub-style anchor: lowercase, no punctuation, spaces to hyphens, repeated titles get -1, -2...
function slugger() {
  const seen = new Map();
  return (title) => {
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

function headings(text, min, max) {
  const slug = slugger(), out = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const title = m[2].replace(/[`*_]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const anchor = slug(title); // every heading takes part in the numbering, even if it is left out of the list
    if (m[1].length >= min && m[1].length <= max) out.push({ level: m[1].length, title, anchor });
  }
  return out;
}

function buildToc(text, min, max, eol) {
  const hs = headings(text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), ''), min, max);
  if (!hs.length) return null;
  const base = Math.min(...hs.map((h) => h.level));
  return [START, ...hs.map((h) => `${'  '.repeat(h.level - base)}- [${h.title}](#${h.anchor})`), END].join(eol);
}

// ---- tables ----
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const isSeparator = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-');

function formatTables(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/), out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence;
    if (inFence || !lines[i].includes('|') || !lines[i + 1] || !isSeparator(lines[i + 1]) || splitRow(lines[i + 1]).length !== splitRow(lines[i]).length) { out.push(lines[i]); continue; }
    const rows = [lines[i]];
    let j = i + 2;
    while (j < lines.length && lines[j].includes('|') && lines[j].trim()) rows.push(lines[j++]);
    const head = splitRow(rows[0]), body = rows.slice(1).map(splitRow);
    const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : c.startsWith(':') ? 'l' : ''));
    const cols = Math.max(head.length, ...body.map((r) => r.length));
    const width = Array.from({ length: cols }, (_, c) => Math.max(3, [...(head[c] || '')].length, ...body.map((r) => [...(r[c] || '')].length)));
    const pad = (s, w, a) => { const gap = w - [...s].length; return a === 'r' ? ' '.repeat(gap) + s : a === 'c' ? ' '.repeat(gap >> 1) + s + ' '.repeat(gap - (gap >> 1)) : s + ' '.repeat(gap); };
    const row = (cells) => '| ' + width.map((w, c) => pad(cells[c] || '', w, aligns[c])).join(' | ') + ' |';
    out.push(row(head));
    out.push('| ' + width.map((w, c) => { const a = aligns[c]; return (a === 'l' || a === 'c' ? ':' : '') + '-'.repeat(w - (a === 'l' || a === 'r' ? 1 : 0) - (a === 'c' ? 2 : 0)) + (a === 'r' || a === 'c' ? ':' : ''); }).join(' | ') + ' |');
    body.forEach((r) => out.push(row(r)));
    i = j - 1;
  }
  return out.join(eol);
}

export function activate(zern) {
  const toast = (type, message) => zern.window.showMessage(type, message);
  const levels = () => { const a = zern.settings.get('tocMinLevel'), b = zern.settings.get('tocMaxLevel'); return [Math.min(a, b), Math.max(a, b)]; };
  const needFile = () => { if (zern.editor.active()) return true; toast('info', 'Open a Markdown file first.'); return false; };

  zern.commands.register('markdownTools.insertToc', () => {
    if (!needFile()) return;
    const text = zern.editor.getDocumentText(), [min, max] = levels(), eol = text.includes('\r\n') ? '\r\n' : '\n';
    if (text.includes(START)) { toast('info', 'This file already has a table of contents. Use "Update Table of Contents".'); return; }
    const toc = buildToc(text, min, max, eol);
    if (!toc) { toast('info', 'No headings found to build a table of contents from.'); return; }
    zern.editor.insertText(toc + eol);
  });

  zern.commands.register('markdownTools.updateToc', () => {
    if (!needFile()) return;
    const text = zern.editor.getDocumentText(), [min, max] = levels(), eol = text.includes('\r\n') ? '\r\n' : '\n';
    const re = new RegExp(`${START}[\\s\\S]*?${END}`);
    if (!re.test(text)) { toast('info', 'This file has no table of contents yet. Use "Insert Table of Contents".'); return; }
    const toc = buildToc(text, min, max, eol);
    if (!toc) { toast('info', 'No headings found.'); return; }
    toast('info', zern.editor.setText(text.replace(re, () => toc)) ? 'Table of contents updated.' : 'Table of contents is already up to date.');
  });

  zern.commands.register('markdownTools.formatTables', () => {
    if (!needFile()) return;
    const info = zern.editor.active();
    const text = zern.editor.getDocumentText(), next = formatTables(text);
    if (next === text) { toast('info', 'No tables to format.'); return; }
    zern.editor.setText(next);
    toast('info', `Tables formatted in ${info.path.split('/').pop()}.`);
  });
}

export function deactivate() { /* nothing to release */ }

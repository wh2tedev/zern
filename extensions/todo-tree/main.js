// ============================================================
// TODO Tree - first-party Zern extension.
// Scans the project's text files for comment tags (TODO, FIXME...)
// and shows them in its own sidebar view, grouped by file.
// ============================================================
const CSS = `
.tt-bar{padding:8px 12px}
.tt-bar input{width:100%;height:26px;padding:0 8px;background:var(--vscode-bg);color:var(--vscode-text);border:1px solid var(--vscode-border);border-radius:2px;font:inherit;font-size:13px;outline:none}
.tt-bar input:focus{border-color:var(--vscode-accent)}
.tt-note{padding:2px 14px 8px;font-size:11.5px;color:var(--vscode-text-dim)}
.tt-empty{padding:14px;font-size:12.5px;color:var(--vscode-text-dim);line-height:1.5}
.tt-file{display:flex;align-items:center;gap:6px;padding:4px 10px;cursor:pointer;font-size:12.5px;user-select:none}
.tt-file:hover{background:var(--vscode-hover-bg)}
.tt-file i{font-size:14px;color:var(--vscode-text-dim)}
.tt-file .tt-dir{color:var(--vscode-text-dim);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tt-count{margin-left:auto;font-size:10.5px;padding:0 6px;border-radius:9px;background:var(--vscode-hover-bg)}
.tt-item{display:flex;gap:7px;align-items:baseline;padding:3px 10px 3px 30px;cursor:pointer;font-size:12.5px}
.tt-item:hover{background:var(--vscode-hover-bg)}
.tt-tag{flex:none;font:600 10px ui-monospace,Consolas,monospace;padding:1px 5px;border-radius:3px;color:#fff;background:#6a7480}
.tt-tag.TODO{background:#2f7bd9}.tt-tag.FIXME,.tt-tag.BUG{background:#d14b4b}.tt-tag.HACK{background:#c98a1b}.tt-tag.NOTE{background:#3f9a6b}
.tt-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-line{flex:none;margin-left:auto;font-size:11px;color:var(--vscode-text-dim)}
`;

const COMMENT_BEFORE = /(\/\/|\/\*|^\s*\*|#|<!--|--|%|;)/;      // a comment marker somewhere before the tag
const PLAIN_TEXT = /\.(md|markdown|txt)$/i;                      // in prose files tags count anywhere
const MAX_BYTES = 400 * 1024;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function activate(zern) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  zern.subscriptions.push({ dispose: () => style.remove() });

  const view = zern.window.createSidebarView({ id: 'todoTree', title: 'TODO Tree', icon: 'checklist', tooltip: 'TODO Tree' });
  let results = new Map();   // path -> [{ line, tag, text }]
  let scope = '';            // '' = whole project, or a folder path
  let filter = '';
  let scanned = false, scanning = false, note = '';

  const tagList = () => zern.settings.get('tags').split(',').map((t) => t.trim()).filter(Boolean);
  const pattern = () => { const t = tagList(); return t.length ? new RegExp(`(?:^|[^A-Za-z0-9_])(${t.map(escapeRe).join('|')})\\b(?:\\(([^)]*)\\))?[:\\s\\-]*(.*)$`) : null; };

  function scanText(path, text, re) {
    const found = [], plain = PLAIN_TEXT.test(path);
    text.split(/\r?\n/).forEach((lineText, i) => {
      const m = re.exec(lineText);
      if (!m) return;
      if (!plain && !COMMENT_BEFORE.test(lineText.slice(0, lineText.indexOf(m[1], m.index)))) return; // needs a comment marker before the tag
      const text = (m[3] || '').replace(/\*\/.*$|-->.*$/, '').trim(); // drop the end of the comment (and anything after it)
      found.push({ line: i + 1, tag: m[1], text: (m[2] ? `(${m[2]}) ` : '') + (text || '(no description)') });
    });
    return found;
  }

  async function scan() {
    if (scanning) return;
    const re = pattern();
    scanning = true; scanned = true; note = ''; render();
    results = new Map();
    if (re) {
      const exts = zern.settings.get('extensions').split(',').map((e) => e.trim()).filter(Boolean);
      let files = await zern.workspace.findFiles({ extensions: exts, max: zern.settings.get('maxFiles') });
      if (scope) files = files.filter((p) => p === scope || p.startsWith(scope + '/'));
      if (zern.workspace.kind() === 'github' && files.length > 40) { files = files.slice(0, 40); note = 'GitHub repositories are limited to 40 files per scan.'; }
      for (let i = 0; i < files.length; i++) {
        let text = null;
        try { text = await zern.workspace.readText(files[i]); } catch { /* unreadable: skip */ }
        if (text != null && text.length <= MAX_BYTES) { const f = scanText(files[i], text, re); if (f.length) results.set(files[i], f); }
        if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
      }
    }
    scanning = false;
    render();
  }

  async function scanFile(path) {
    const re = pattern();
    if (!re || !scanned || scanning) return;
    const text = await zern.workspace.readText(path);
    if (text == null) return;
    const found = scanText(path, text, re);
    found.length ? results.set(path, found) : results.delete(path);
    render();
  }

  // ---------------- rendering ----------------
  const esc = zern.util.escapeHtml;
  function render() {
    const q = filter.toLowerCase();
    let total = 0, html = '';
    for (const [path, items] of [...results.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const shown = items.filter((x) => !q || `${x.tag} ${x.text} ${path}`.toLowerCase().includes(q));
      if (!shown.length) continue;
      total += shown.length;
      const cut = path.lastIndexOf('/');
      html += `<div class="tt-file" data-path="${esc(path)}"><i class="zi zi-file"></i><span>${esc(path.slice(cut + 1))}</span><span class="tt-dir">${esc(path.slice(0, cut) || '/')}</span><span class="tt-count">${shown.length}</span></div>`;
      html += shown.map((x) => `<div class="tt-item" data-path="${esc(path)}" data-line="${x.line}" title="${esc(path)}:${x.line}"><span class="tt-tag ${esc(x.tag)}">${esc(x.tag)}</span><span class="tt-text">${esc(x.text)}</span><span class="tt-line">${x.line}</span></div>`).join('');
    }
    let total2 = 0; for (const items of results.values()) total2 += items.length;
    view.setBadge(total2);
    view.setTitle(scope ? `TODO Tree · ${scope.split('/').pop()}` : 'TODO Tree');
    const msg = scanning ? 'Scanning…' : !scanned ? 'Open this view to scan the project.' : (total ? '' : (results.size ? 'Nothing matches your filter.' : `No ${tagList().join(', ')} comments found.`));
    list.innerHTML = (msg ? `<div class="tt-empty">${esc(msg)}</div>` : '') + html;
    noteEl.textContent = note + (scope ? ` Scanning only ${scope}.` : '');
    noteEl.hidden = !noteEl.textContent.trim();
  }

  const root = view.el;
  root.innerHTML = '<div class="tt-bar"><input type="text" placeholder="Filter results" aria-label="Filter results" autocomplete="off" spellcheck="false"></div><div class="tt-note" hidden></div><div class="tt-list"></div>';
  const noteEl = root.querySelector('.tt-note'), list = root.querySelector('.tt-list');
  root.querySelector('input').addEventListener('input', (e) => { filter = e.target.value.trim(); render(); });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-path]');
    if (row) zern.workspace.openFile(row.dataset.path, { line: Number(row.dataset.line) || undefined });
  });

  view.setActions([
    { icon: 'refresh', title: 'Refresh', run: () => scan() },
    { icon: 'clear-all', title: 'Scan the whole project', run: () => { scope = ''; scan(); } },
  ]);
  view.onDidShow(() => { if (!scanned) scan(); });
  render();

  zern.commands.register('todoTree.show', () => view.show());
  zern.commands.register('todoTree.refresh', () => { view.show(); scan(); });
  zern.commands.register('todoTree.scanProject', () => { scope = ''; view.show(); scan(); });
  zern.commands.register('todoTree.scanFolder', (arg) => { if (!arg || !arg.path) return; scope = arg.path === '/' ? '' : arg.path; view.show(); scan(); });
  zern.workspace.onDidSave((path) => { if (zern.settings.get('scanOnSave')) scanFile(path); });
  zern.settings.onDidChange(() => { if (scanned) scan(); });
}

export function deactivate() { /* released through zern.subscriptions */ }

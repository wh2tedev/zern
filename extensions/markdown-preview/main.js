// ============================================================
// Markdown Preview - first-party Zern extension.
// Renders the active .md file in a side panel using zern.markdown.
// Raw HTML is escaped by the renderer, so nothing in the file can run.
// ============================================================
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

const CSS = `
.mp{height:100%;overflow:auto;padding:18px 30px 60px;font-size:var(--mp-fs,15px);line-height:1.65;color:var(--vscode-text)}
.mp h1{font-size:1.9em;margin:.6em 0 .4em;padding-bottom:.3em;border-bottom:1px solid var(--vscode-border)}
.mp h2{font-size:1.45em;margin:1.3em 0 .4em;padding-bottom:.25em;border-bottom:1px solid var(--vscode-border)}
.mp h3{font-size:1.2em;margin:1.1em 0 .3em}.mp h4{font-size:1em;margin:1em 0 .3em}
.mp p,.mp ul,.mp ol,.mp pre,.mp table,.mp blockquote{margin:0 0 .9em}
.mp ul,.mp ol{padding-left:1.6em}.mp li{margin:.2em 0}.mp li input{margin-right:6px}
.mp a{color:#3794ff}
.mp code{font:.88em ui-monospace,Consolas,monospace;padding:.15em .4em;border-radius:3px;background:var(--vscode-hover-bg)}
.mp pre{padding:12px 14px;border-radius:6px;background:var(--vscode-sidebar-bg);border:1px solid var(--vscode-border);overflow-x:auto}
.mp pre code{padding:0;background:none;line-height:1.5}
.mp blockquote{padding:4px 14px;border-left:3px solid var(--vscode-accent);background:var(--vscode-hover-bg)}
.mp table{border-collapse:collapse}.mp th,.mp td{padding:6px 12px;border:1px solid var(--vscode-border);text-align:left}.mp th{background:var(--vscode-sidebar-bg)}
.mp img{max-width:100%}.mp hr{border:0;border-top:1px solid var(--vscode-border);margin:1.4em 0}
.mp-empty{color:var(--vscode-text-dim)}
`;

export function activate(zern) {
  const isMd = (p) => /\.(md|markdown|mdx)$/i.test(p || '');
  const base = (p) => (p || '').split('/').pop();

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  zern.subscriptions.push({ dispose: () => style.remove() });

  let panel = null, wrap = null, current = null, timer = null, scrollSub = null, token = 0;

  const applySize = () => { if (wrap) wrap.style.setProperty('--mp-fs', zern.settings.get('fontSize') + 'px'); };
  zern.settings.onDidChange((key) => { if (key === 'fontSize') applySize(); });

  async function inlineImages(el, path) {
    const dir = path.slice(0, path.lastIndexOf('/') + 1) || '/';
    for (const img of el.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (!src || /^(https?:|data:)/i.test(src)) continue;
      let p;
      try { p = decodeURIComponent(new URL(src, 'http://x' + dir).pathname); } catch { continue; }
      const f = await zern.workspace.readBytes(p);
      if (!f) { img.removeAttribute('src'); img.title = `Image not found: ${src}`; continue; }
      const type = MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
      img.src = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([f.bytes], { type })); });
    }
  }

  async function render() {
    if (!panel || !current) return;
    const mine = ++token;
    const text = await zern.workspace.readText(current);
    if (mine !== token) return; // a newer render started
    const top = wrap.scrollTop;
    wrap.innerHTML = text == null ? '<p class="mp-empty">This file is not available.</p>' : zern.markdown.render(text, '');
    wrap.scrollTop = top;
    if (text != null) await inlineImages(wrap, current);
  }

  function bindScroll() {
    if (scrollSub) { scrollSub.dispose(); scrollSub = null; }
    scrollSub = zern.editor.onDidScroll((ratio) => {
      if (!zern.settings.get('syncScroll') || !wrap) return;
      wrap.scrollTop = ratio * Math.max(0, wrap.scrollHeight - wrap.clientHeight);
    });
  }

  function ensurePanel() {
    if (panel) return;
    panel = zern.window.createSidePanel({ title: 'Markdown Preview' });
    zern.subscriptions.push(panel);
    wrap = document.createElement('div');
    wrap.className = 'mp';
    panel.el.appendChild(wrap);
    panel.onDidHide(() => { if (scrollSub) { scrollSub.dispose(); scrollSub = null; } });
    applySize();
  }

  async function open(path) {
    const p = path || zern.workspace.activePath();
    if (!isMd(p)) { zern.window.showMessage('info', 'Open a Markdown (.md) file to preview it.'); return; }
    current = p;
    ensurePanel();
    panel.setTitle('Preview: ' + base(p));
    panel.show();
    bindScroll();
    await render();
  }

  zern.commands.register('markdownPreview.open', () => open());
  zern.commands.register('markdownPreview.close', () => panel && panel.hide());

  zern.workspace.onDidChangeContent((path) => {
    if (!panel || !panel.visible || path !== current) return;
    clearTimeout(timer);
    timer = setTimeout(render, zern.settings.get('refreshDelay'));
  });
  zern.subscriptions.push({ dispose: () => clearTimeout(timer) });

  const item = zern.window.createStatusBarItem({ text: '$(markdown) Preview', tooltip: 'Open Markdown Preview (Ctrl+Alt+M)', command: 'markdownPreview.open', alignment: 'right' });
  const sync = (p) => {
    p = p || zern.workspace.activePath();
    isMd(p) ? item.show() : item.hide();
    if (panel && panel.visible && isMd(p) && p !== current) { current = p; panel.setTitle('Preview: ' + base(p)); render(); }
  };
  zern.workspace.onDidChangeActive(sync);
  sync();
}

export function deactivate() { /* everything is released through zern.subscriptions */ }

// ============================================================
// HTML Preview - first-party Zern extension.
//
// Two ways to render, picked automatically:
//  - server   Files are served to the iframe by Zern's service worker
//             (zern.serve), so <link>, <script>, images, fetch() and links
//             between pages resolve like on a real web server.
//  - isolated Used for GitHub repositories (untrusted code) or when no
//             service worker is available (file://, desktop app). Files are
//             inlined into a sandboxed srcdoc with no access to Zern's data.
// ============================================================

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', xml: 'application/xml', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', wasm: 'application/wasm',
};
const mimeOf = (p) => MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

// Injected in every previewed page: forwards console output, errors and navigation to the panel.
const BRIDGE = '<script>(function(){var P=parent;function s(m){try{P.postMessage(Object.assign({__zernPreview:1},m),"*")}catch(e){}}' +
  'function f(x){try{if(typeof x==="string")return x;if(x instanceof Error)return x.stack||x.message;if(x===undefined)return "undefined";return JSON.stringify(x)}catch(e){return String(x)}}' +
  '["log","info","warn","error","debug"].forEach(function(l){var o=console[l];console[l]=function(){s({kind:"console",level:l,text:[].slice.call(arguments).map(f).join(" ")});o.apply(console,arguments)}});' +
  'addEventListener("error",function(e){s({kind:"console",level:"error",text:(e.message||"Error")+(e.filename?" ("+e.filename.split("/").pop()+":"+e.lineno+")":"")})});' +
  'addEventListener("unhandledrejection",function(e){s({kind:"console",level:"error",text:"Unhandled rejection: "+f(e.reason&&e.reason.message||e.reason)})});' +
  'addEventListener("load",function(){s({kind:"nav",href:location.pathname+location.search+location.hash,title:document.title})});})();<\/script>';

const DEVICES = { responsive: 0, mobile: 375, tablet: 768, desktop: 1280 };

const injectBridge = (html) => /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + BRIDGE) : BRIDGE + html;
const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const notFoundPage = (p) => `<!DOCTYPE html><meta charset="utf-8"><body style="font:15px system-ui;padding:32px;color:#444"><h2 style="margin:0 0 8px">404</h2><code>${esc(p)}</code> was not found in the workspace.</body>`;
const dataUrl = (bytes, type) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([bytes], { type })); });

const CSS = `
.hp{display:flex;flex-direction:column;height:100%;min-height:0}
.hp-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--vscode-border)}
.hp-bar button,.hp-bar select{background:transparent;color:var(--vscode-text);border:1px solid transparent;border-radius:4px;height:26px;font:12px/1 inherit;cursor:pointer}
.hp-bar button{width:28px;display:grid;place-items:center;position:relative}
.hp-bar button:hover,.hp-bar select:hover{background:var(--vscode-hover-bg)}
.hp-bar button:disabled{opacity:.35;cursor:default}
.hp-bar select{padding:0 4px;border-color:var(--vscode-border);background:var(--vscode-sidebar-bg)}
.hp-addr{flex:1;min-width:0;height:26px;padding:0 10px;border:1px solid var(--vscode-border);border-radius:13px;background:var(--vscode-bg);color:var(--vscode-text);font:12px/1 ui-monospace,Consolas,monospace}
.hp-mode{font-size:10.5px;color:var(--vscode-text-dim);padding:0 6px;border:1px solid var(--vscode-border);border-radius:9px;white-space:nowrap}
.hp-badge{position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;border-radius:8px;background:#f14c4c;color:#fff;font:600 10px/15px system-ui;text-align:center;padding:0 3px}
.hp-stage{flex:1;min-height:0;display:flex;justify-content:center;background:var(--vscode-sidebar-bg);overflow:auto}
.hp-stage iframe{border:0;background:#fff;width:100%;height:100%}
.hp-stage.sized{padding:12px}.hp-stage.sized iframe{max-width:100%;border-radius:6px;box-shadow:0 0 0 1px var(--vscode-border),0 8px 24px rgba(0,0,0,.3)}
.hp-con{border-top:1px solid var(--vscode-border);height:34%;min-height:90px;display:flex;flex-direction:column;background:var(--vscode-bg)}
.hp-con[hidden]{display:none}
.hp-con-head{display:flex;justify-content:space-between;align-items:center;padding:4px 10px;font-size:11px;letter-spacing:.04em;color:var(--vscode-text-dim);text-transform:uppercase}
.hp-con-head button{background:none;border:0;color:var(--vscode-text-dim);cursor:pointer;font-size:11px}
.hp-con-list{flex:1;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace}
.hp-line{padding:2px 10px;border-top:1px solid var(--vscode-border);white-space:pre-wrap;word-break:break-word}
.hp-line.warn{color:#cca700;background:rgba(204,167,0,.08)}.hp-line.error{color:#f48771;background:rgba(241,76,76,.1)}.hp-line.empty{color:var(--vscode-text-dim);border:0}
`;

export function activate(zern) {
  const isHtml = (p) => /\.html?$/i.test(p || '');
  const base = (p) => (p || '').split('/').pop();

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  zern.subscriptions.push({ dispose: () => style.remove() });

  let panel = null, ui = null, server = null, current = null, errors = 0, timer = null, keepScroll = null, lastMode = null;
  const trustDeclined = new Set(); // workspaces where the user chose not to trust the project (this session)

  const modeNow = () => (zern.workspace.kind() === 'github' || !zern.serve.available()) ? 'isolated' : 'server';

  // ---------- virtual server (server mode) ----------
  async function handle(req) {
    let p = decodeURIComponent(req.path);
    if (p.endsWith('/')) p += 'index.html';
    let f = await zern.workspace.readBytes(p);
    if (!f && !/\.[a-z0-9]+$/i.test(p)) { p += '/index.html'; f = await zern.workspace.readBytes(p); }
    if (!f) return { status: 404, headers: { 'Content-Type': MIME.html }, body: new TextEncoder().encode(notFoundPage(req.path)).buffer };
    const type = mimeOf(p);
    if (type.startsWith('text/html')) {
      const html = injectBridge(new TextDecoder().decode(f.bytes));
      return { status: 200, headers: { 'Content-Type': type }, body: new TextEncoder().encode(html).buffer };
    }
    return { status: 200, headers: { 'Content-Type': type }, body: f.bytes };
  }

  // ---------- isolated mode: inline everything into srcdoc ----------
  async function buildSrcdoc(path) {
    const html = await zern.workspace.readText(path);
    if (html == null) return notFoundPage(path);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dir = path.slice(0, path.lastIndexOf('/') + 1) || '/';
    const local = (h) => (!h || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(h)) ? null : decodeURIComponent(new URL(h, 'http://x' + dir).pathname);

    for (const l of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
      const p = local(l.getAttribute('href')); const t = p && await zern.workspace.readText(p);
      if (t != null) { const s = doc.createElement('style'); s.textContent = t; l.replaceWith(s); }
    }
    for (const sc of doc.querySelectorAll('script[src]')) {
      const p = local(sc.getAttribute('src')); const t = p && await zern.workspace.readText(p);
      if (t != null) {
        const n = doc.createElement('script');
        if (sc.type) n.type = sc.type;
        n.textContent = t.replace(/<\/script/gi, '<\\/script');
        sc.replaceWith(n);
      }
    }
    for (const el of doc.querySelectorAll('img[src],source[src],video[poster],link[rel~="icon"][href]')) {
      const attr = el.hasAttribute('src') ? 'src' : el.hasAttribute('poster') ? 'poster' : 'href';
      const p = local(el.getAttribute(attr)); const f = p && await zern.workspace.readBytes(p);
      if (f) el.setAttribute(attr, await dataUrl(f.bytes, mimeOf(p)));
    }
    return injectBridge('<!DOCTYPE html>' + doc.documentElement.outerHTML);
  }

  // ---------- panel ----------
  function ensurePanel() {
    if (panel) return;
    panel = zern.window.createSidePanel({ title: 'Preview' });
    zern.subscriptions.push(panel);
    panel.el.innerHTML = `<div class="hp">
      <div class="hp-bar">
        <button data-a="reload" title="Reload"><i class="zi zi-refresh"></i></button>
        <input class="hp-addr" readonly value="/" aria-label="Current page">
        <span class="hp-mode" hidden></span>
        <select data-a="device" title="Screen size">
          <option value="0">Responsive</option><option value="375">Mobile · 375</option>
          <option value="768">Tablet · 768</option><option value="1280">Desktop · 1280</option>
        </select>
        <button data-a="external" title="Open in a new tab"><i class="zi zi-link-external"></i></button>
        <button data-a="console" title="Toggle console"><i class="zi zi-terminal"></i><span class="hp-badge" hidden>0</span></button>
      </div>
      <div class="hp-stage"><iframe title="HTML preview"></iframe></div>
      <div class="hp-con" hidden>
        <div class="hp-con-head"><span>Console</span><button data-a="clear">Clear</button></div>
        <div class="hp-con-list"></div>
      </div></div>`;
    const q = (s) => panel.el.querySelector(s);
    ui = { frame: q('iframe'), stage: q('.hp-stage'), addr: q('.hp-addr'), mode: q('.hp-mode'), badge: q('.hp-badge'), con: q('.hp-con'), list: q('.hp-con-list'), ext: q('[data-a=external]') };
    panel.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'reload') reload();
      if (b.dataset.a === 'external') { try { window.open(ui.frame.contentWindow.location.href, '_blank', 'noopener'); } catch { /* isolated */ } }
      if (b.dataset.a === 'console') ui.con.hidden = !ui.con.hidden;
      if (b.dataset.a === 'clear') clearConsole();
    });
    const setDevice = (w) => {
      q('[data-a=device]').value = String(w);
      ui.stage.classList.toggle('sized', w > 0);
      ui.frame.style.width = w ? w + 'px' : '';
    };
    q('[data-a=device]').addEventListener('change', (e) => setDevice(+e.target.value));
    setDevice(DEVICES[zern.settings.get('defaultDevice')] || 0);
    const onMsg = (e) => {
      const m = e.data;
      if (!m || !m.__zernPreview || e.source !== ui.frame.contentWindow) return;
      if (m.kind === 'console') addLine(m.level, m.text);
      if (m.kind === 'nav') onNav(m);
    };
    window.addEventListener('message', onMsg);
    zern.subscriptions.push({ dispose: () => window.removeEventListener('message', onMsg) });
    clearConsole();
  }

  function addLine(level, text) {
    const empty = ui.list.querySelector('.empty'); if (empty) empty.remove();
    const d = document.createElement('div');
    d.className = 'hp-line ' + (level === 'warn' ? 'warn' : level === 'error' ? 'error' : '');
    d.textContent = text;
    ui.list.appendChild(d);
    while (ui.list.children.length > 500) ui.list.firstChild.remove();
    ui.list.scrollTop = ui.list.scrollHeight;
    if (level === 'error') { errors++; ui.badge.textContent = errors > 99 ? '99+' : errors; ui.badge.hidden = false; }
  }
  function clearConsole() {
    errors = 0; ui.badge.hidden = true;
    ui.list.innerHTML = '<div class="hp-line empty">No console output yet.</div>';
  }
  function onNav(m) {
    if (lastMode === 'server' && server) {
      const prefix = new URL(server.baseUrl).pathname;
      ui.addr.value = '/' + decodeURIComponent(m.href.startsWith(prefix) ? m.href.slice(prefix.length) : m.href);
      if (keepScroll != null) { try { ui.frame.contentWindow.scrollTo(0, keepScroll); } catch { /* ignore */ } keepScroll = null; }
    }
  }

  // ---------- loading ----------
  async function load(clear) {
    if (!current) return;
    ensurePanel();
    if (clear) clearConsole();
    panel.setTitle('Preview: ' + base(current));
    let mode = modeNow();
    const wsId = zern.workspace.trustId();
    let untrusted = false;
    if (mode === 'server') {
      // The full preview runs the project's scripts in Zern's own origin: ask before doing that (once per project)
      if (trustDeclined.has(wsId)) untrusted = true;
      else if (!(await zern.workspace.requestTrust({ reason: "The full preview runs your project's own scripts in the same origin as Zern, so they could read data kept in this browser, such as a GitHub token." }))) { trustDeclined.add(wsId); untrusted = true; }
      if (untrusted) mode = 'isolated';
    }
    lastMode = mode;
    ui.mode.hidden = mode !== 'isolated';
    ui.mode.textContent = 'Isolated';
    ui.mode.style.cursor = untrusted ? 'pointer' : '';
    ui.mode.title = untrusted
      ? 'This project is not trusted, so the preview runs in a sandbox (no relative fetch() or page navigation). Click to trust it and get the full preview.'
      : 'Files are inlined and the page runs in a sandbox. Relative fetch() and page navigation are not available.';
    ui.mode.onclick = untrusted ? () => { trustDeclined.delete(wsId); load(false); } : null;
    ui.ext.disabled = lastMode === 'isolated';
    if (lastMode === 'server') {
      if (!server) server = zern.serve.register(handle);
      ui.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads');
      const url = server.baseUrl + current.replace(/^\//, '').split('/').map(encodeURIComponent).join('/');
      ui.addr.value = current;
      ui.frame.removeAttribute('srcdoc');
      ui.frame.src = url;
    } else {
      ui.frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
      ui.addr.value = current;
      ui.frame.removeAttribute('src');
      ui.frame.srcdoc = await buildSrcdoc(current);
    }
  }

  function reload() {
    if (!panel || !current) return;
    if (lastMode === 'server') {
      try { keepScroll = ui.frame.contentWindow.scrollY; ui.frame.contentWindow.location.reload(); return; } catch { /* fall through */ }
    }
    load(false);
  }

  async function open(path) {
    const p = path || zern.workspace.activePath();
    if (!isHtml(p)) { zern.window.showMessage('info', 'Open an .html file to preview it.'); return; }
    current = p;
    ensurePanel();
    panel.show();
    await load(true);
  }

  zern.commands.register('htmlPreview.open', () => open());
  zern.commands.register('htmlPreview.reload', () => reload());
  zern.commands.register('htmlPreview.close', () => panel && panel.hide());

  // Live reload: any edit (even unsaved) refreshes the preview
  zern.workspace.onDidChangeContent(() => {
    if (!panel || !panel.visible || !zern.settings.get('autoReload')) return;
    clearTimeout(timer);
    timer = setTimeout(reload, zern.settings.get('reloadDelay'));
  });
  zern.subscriptions.push({ dispose: () => clearTimeout(timer) });

  // Status bar button, visible only on HTML files; the preview follows the active HTML file
  const item = zern.window.createStatusBarItem({ text: '$(eye) Preview', tooltip: 'Open HTML Preview (Ctrl+Alt+V)', command: 'htmlPreview.open', alignment: 'right' });
  const syncActive = (p) => {
    p = p || zern.workspace.activePath();
    isHtml(p) ? item.show() : item.hide();
    if (panel && panel.visible && isHtml(p) && p !== current) { current = p; load(true); }
  };
  zern.workspace.onDidChangeActive(syncActive);
  syncActive();
}

export function deactivate() { /* everything is released through zern.subscriptions */ }

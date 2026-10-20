// ============================================================
// landing.js - Welcome page. Shown automatically on the very
// first visit; "Try on web" / "Open Zern" dismiss it and drop
// you straight into the editor. Re-openable any time from the
// Command Palette ("Help: Show Welcome Page").
// Also: top-bar dropdowns, copy buttons, the Terms / Privacy /
// licenses panel and the right-click menus on the logo and the
// download button. Everything here uses textContent / cloned
// <template>s: no HTML is built from strings.
// ============================================================

const SEEN_KEY = 'zern_landing_seen_v1';
const RELEASES_URL = 'https://github.com/wh2tedev/zern/releases/latest';
const REPO_URL = 'https://github.com/wh2tedev/zern';
const NOTICES_URL = 'THIRD_PARTY_NOTICES.txt';

let el = null;
let menuEl = null;
let legalOpener = null;

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: it will simply show again next time */ }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isVisible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);

export function showLanding() {
  if (!el) return;
  el.classList.remove('l-out');
  el.hidden = false;
  el.scrollTop = 0;
  const first = [...el.querySelectorAll('[data-l-open]')].find(isVisible);
  first && first.focus({ preventScroll: true });
}

export function closeLanding() {
  if (!el || el.hidden) return;
  closeMenu(); closeDropdowns(); closeLegal();
  markSeen();
  el.classList.add('l-out');
  setTimeout(() => { el.hidden = true; el.classList.remove('l-out'); }, 350);
}

// ---------- copy ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function wireCopyButtons() {
  el.querySelectorAll('[data-copy-target]').forEach((btn) => btn.addEventListener('click', async () => {
    const target = el.querySelector(`#${btn.dataset.copyTarget}`);
    if (!target) return;
    const label = btn.textContent;
    btn.textContent = (await copyText(target.textContent.trim())) ? 'Copied' : 'Press Ctrl+C';
    setTimeout(() => { btn.textContent = label; }, 1600);
  }));
}

// ---------- top-bar dropdowns ----------
function closeDropdowns(except) {
  el.querySelectorAll('.l-navbtn[aria-expanded="true"]').forEach((b) => {
    if (b === except) return;
    b.setAttribute('aria-expanded', 'false');
    const pop = el.querySelector(`#${b.dataset.dd}`);
    if (pop) pop.hidden = true;
  });
}

function wireDropdowns() {
  el.querySelectorAll('.l-navbtn').forEach((btn) => {
    const pop = el.querySelector(`#${btn.dataset.dd}`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = btn.getAttribute('aria-expanded') !== 'true';
      closeDropdowns(btn); closeMenu();
      btn.setAttribute('aria-expanded', String(open));
      pop.hidden = !open;
      if (open && e.detail === 0) pop.querySelector('a')?.focus(); // opened with the keyboard
    });
    pop.addEventListener('click', () => { btn.setAttribute('aria-expanded', 'false'); pop.hidden = true; });
    pop.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...pop.querySelectorAll('a')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    });
  });
  el.addEventListener('click', () => closeDropdowns());
}

// ---------- right-click menu ----------
function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

function showMenu(x, y, items) {
  closeMenu(); closeDropdowns();
  menuEl = document.createElement('ul');
  menuEl.className = 'l-menu';
  menuEl.setAttribute('role', 'menu');
  for (const it of items) {
    const li = document.createElement('li');
    li.setAttribute('role', 'none');
    if (it.separator) { li.appendChild(document.createElement('hr')); menuEl.appendChild(li); continue; }
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = it.label;
    b.addEventListener('click', () => { closeMenu(); it.run(); });
    li.appendChild(b); menuEl.appendChild(li);
  }
  el.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(6, Math.min(x, window.innerWidth - r.width - 6))}px`;
  menuEl.style.top = `${Math.max(6, Math.min(y, window.innerHeight - r.height - 6))}px`;
  menuEl.querySelector('button')?.focus();
}

function download(href, name) {
  const a = document.createElement('a');
  a.href = href; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

function toast(text) {
  // The app's own toast system may not be ready behind the landing; a one-line live note is enough
  const n = document.createElement('div');
  n.setAttribute('role', 'status');
  n.textContent = text;
  n.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:40;padding:10px 16px;border-radius:9px;background:#111;color:#fff;font:14px Inter,system-ui,sans-serif';
  el.appendChild(n);
  setTimeout(() => n.remove(), 1800);
}

function wireContextMenus() {
  const logo = el.querySelector('#l-logo');
  const canFetch = location.protocol !== 'file:'; // the desktop app loads from disk, where fetch() is not allowed
  logo.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      ...(canFetch ? [{ label: 'Copy logo as SVG', run: async () => {
        try { const svg = await (await fetch('assets/logo/logo.svg')).text(); toast((await copyText(svg)) ? 'Logo SVG copied' : 'Could not copy'); }
        catch { toast('Could not copy'); }
      } }] : []),
      { label: 'Download logo (PNG)', run: () => download('assets/logo/logo-512.png', 'zern-logo.png') },
      { separator: true },
      { label: 'Go to top', run: () => el.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }) },
      { label: 'Zern on GitHub', run: () => window.open(REPO_URL, '_blank', 'noopener') },
    ]);
  });

  const downloadItems = (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: 'Open Releases page', run: () => window.open(RELEASES_URL, '_blank', 'noopener') },
      { label: 'Copy download link', run: async () => toast((await copyText(RELEASES_URL)) ? 'Link copied' : 'Could not copy') },
      { label: 'Copy install command', run: async () => toast((await copyText('sudo apt install ./zern*.deb')) ? 'Command copied' : 'Could not copy') },
    ]);
  };
  el.querySelectorAll('#l-dl, .l-install, .l-dl-card .l-btn.w[href]').forEach((n) => n.addEventListener('contextmenu', downloadItems));

  el.addEventListener('click', closeMenu);
  el.addEventListener('scroll', closeMenu, { passive: true });
}

// ---------- Terms / Privacy / licenses ----------
let noticesLoaded = false;
async function loadNotices() {
  if (noticesLoaded) return;
  const pre = el.querySelector('#l-notice-pre');
  if (!pre) return;
  try {
    const res = await fetch(NOTICES_URL);
    if (!res.ok) throw new Error(String(res.status));
    pre.textContent = await res.text();
    noticesLoaded = true;
  } catch {
    pre.textContent = `The full text could not be loaded here. It is in the file THIRD_PARTY_NOTICES.txt of the project: ${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.txt`;
  }
}

function openLegal(kind, opener) {
  const tpl = el.querySelector(`#l-tpl-${kind}`);
  const panel = el.querySelector('#l-legal');
  if (!tpl || !panel) return;
  closeMenu(); closeDropdowns();
  legalOpener = opener || null;
  el.querySelector('#l-legal-title').textContent = tpl.dataset.title || '';
  const body = el.querySelector('#l-legal-body');
  body.replaceChildren(tpl.content.cloneNode(true));
  body.scrollTop = 0;
  panel.hidden = false;
  el.querySelector('[data-l-legal-close]').focus();
  if (kind === 'licenses') {
    const d = body.querySelector('#l-notice-d');
    d && d.addEventListener('toggle', () => { if (d.open) loadNotices(); }, { once: true });
  }
}

function closeLegal() {
  const panel = el && el.querySelector('#l-legal');
  if (!panel || panel.hidden) return false;
  panel.hidden = true;
  el.querySelector('#l-legal-body').replaceChildren();
  noticesLoaded = false;
  legalOpener && legalOpener.focus && legalOpener.focus({ preventScroll: true });
  legalOpener = null;
  return true;
}

function wireLegal() {
  el.querySelectorAll('[data-legal]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openLegal(a.dataset.legal, a); }));
  const panel = el.querySelector('#l-legal');
  panel.addEventListener('click', (e) => { if (e.target === panel) closeLegal(); });
  el.querySelector('[data-l-legal-close]').addEventListener('click', closeLegal);
  panel.addEventListener('keydown', (e) => { // keep Tab inside the panel
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll('button, a[href], summary, [tabindex="0"]')].filter(isVisible);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

export function initLanding() {
  el = document.getElementById('landing');
  if (!el) return;

  // Inside the desktop app there is nothing to download and no "web" to try
  if (window.zernDesktop) {
    el.classList.add('l-desktop');
    el.querySelectorAll('.l-desk-only').forEach((n) => { n.hidden = false; });
  }

  el.querySelectorAll('[data-l-open]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); closeLanding(); }));

  // In-page links scroll inside the overlay
  el.querySelectorAll('a[href^="#"]:not([data-l-open]):not([data-legal])').forEach((a) => a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    const target = id.length > 1 ? el.querySelector(id) : null;
    if (id === '#l-top') { e.preventDefault(); el.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); return; }
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
  }));

  // Live theme switcher on the demo editor
  const demo = el.querySelector('#l-ed');
  const buttons = el.querySelectorAll('.l-sw button');
  buttons.forEach((b) => b.addEventListener('click', () => {
    demo.dataset.t = b.dataset.t;
    buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));

  wireCopyButtons();
  wireDropdowns();
  wireContextMenus();
  wireLegal();

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    if (menuEl) { closeMenu(); return; }
    if (closeLegal()) return;
    if (el.querySelector('.l-navbtn[aria-expanded="true"]')) { closeDropdowns(); return; }
    closeLanding();
  });
}

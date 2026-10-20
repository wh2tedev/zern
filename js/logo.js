// ============================================================
// logo.js - Repaints the browser-tab favicon with the active
// theme's accent color so it matches the in-app Zern logo.
// (The in-app logo itself is pure CSS: see .zern-mark.)
// ============================================================

let maskImg = null;

function paint(color) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.drawImage(maskImg, 0, 0, size, size);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  const link = document.querySelector('link[rel="icon"]');
  if (link) { link.type = 'image/png'; link.href = c.toDataURL('image/png'); }
}

export function updateLogoTheme() {
  const color = getComputedStyle(document.body).getPropertyValue('--vscode-accent').trim();
  if (!color) return;
  try {
    if (maskImg) { paint(color); return; }
    const img = new Image();
    img.onload = () => { maskImg = img; try { paint(color); } catch { /* file:// canvas is tainted: keep the static favicon */ } };
    img.src = 'assets/logo/logo-512.png';
  } catch { /* keep the static favicon */ }
}

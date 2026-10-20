// ============================================================
// context-menu.js - Generic VS Code-style context menu
// ============================================================
import { escapeHtml } from './escape.js';

let menuEl = null;

function onOutsideClick(e) {
  if (menuEl && !menuEl.contains(e.target)) closeContextMenu();
}
function onEscape(e) {
  if (e.key === 'Escape') closeContextMenu();
}

export function showContextMenu(x, y, items) {
  closeContextMenu();
  menuEl = document.createElement('ul');
  menuEl.className = 'context-menu';

  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement('li');
      sep.className = 'context-menu-separator';
      menuEl.appendChild(sep);
      return;
    }
    const li = document.createElement('li');
    li.className = 'context-menu-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '');
    li.innerHTML = `<span class="cm-icon">${item.icon || ''}</span><span class="cm-label">${escapeHtml(item.label)}</span>${item.keybinding ? `<span class="cm-key">${escapeHtml(item.keybinding)}</span>` : ''}`;
    if (item.disabled) {
      // Disabled entries are shown greyed out; clicking them does nothing
      // (and keeps the menu open, like native menus do).
      li.setAttribute('aria-disabled', 'true');
      li.addEventListener('click', (e) => e.stopPropagation());
      menuEl.appendChild(li);
      return;
    }
    li.addEventListener('click', () => {
      closeContextMenu();
      item.action && item.action();
    });
    menuEl.appendChild(li);
  });

  document.body.appendChild(menuEl);

  const rect = menuEl.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menuEl.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
  menuEl.style.top = `${Math.max(4, Math.min(y, maxY))}px`;

  setTimeout(() => {
    document.addEventListener('click', onOutsideClick);
    document.addEventListener('contextmenu', onOutsideClick);
    document.addEventListener('keydown', onEscape);
  }, 0);
}

export function closeContextMenu() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  document.removeEventListener('click', onOutsideClick);
  document.removeEventListener('contextmenu', onOutsideClick);
  document.removeEventListener('keydown', onEscape);
}

// ============================================================
// context-menu.js - Generic VS Code-style context menu
// ============================================================

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
    li.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    li.innerHTML = `<span class="cm-icon">${item.icon || ''}</span><span class="cm-label">${item.label}</span>${item.keybinding ? `<span class="cm-key">${item.keybinding}</span>` : ''}`;
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

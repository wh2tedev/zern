// ============================================================
// titlebar.js - VS Code-style title bar: application menu
// (File / Edit / View / Go / Help), command center (click = Go to
// File) and layout buttons. It owns no logic of its own: every
// entry just calls a function handed in by app.js, so the menus
// can never drift out of sync with the commands/shortcuts.
// ============================================================

import { AppState } from './state.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';
import { getKey } from './keybindings.js';

let api = null;
let openMenuName = null;

const hasFile = () => !!AppState.activeFilePath;
const kb = (id) => getKey(id) || ''; // shortcut currently assigned (customizable)

function buildMenus() {
  const ed = (id) => () => api.runEditorAction(id);
  const need = !hasFile(); // editor-bound entries are greyed out with no file open
  return {
    file: [
      { label: 'New File', action: api.newFile },
      { label: 'New Folder', action: api.newFolder },
      { separator: true },
      { label: 'Open Folder...', action: api.openFolder },
      { label: 'Use Virtual Filesystem', action: api.useVirtual },
      { label: 'Open GitHub Repository...', action: api.openGithub },
      { separator: true },
      { label: 'Save', keybinding: kb('app.file.save'), disabled: need, action: api.save },
      { label: 'Save All', action: api.saveAll },
      { separator: true },
      { label: 'Export Project as ZIP', action: api.exportZip },
      { label: 'Import Project from ZIP', action: api.importZip },
      { separator: true },
      { label: 'Keyboard Shortcuts', action: api.openKeyboardShortcuts },
      { label: 'Settings (JSON)', action: api.openSettingsJson },
    ],
    edit: [
      { label: 'Undo', keybinding: 'Ctrl+Z', disabled: need, action: ed('undo') },
      { label: 'Redo', keybinding: 'Ctrl+Y', disabled: need, action: ed('redo') },
      { separator: true },
      { label: 'Find', keybinding: 'Ctrl+F', disabled: need, action: ed('actions.find') },
      { label: 'Replace', keybinding: 'Ctrl+H', disabled: need, action: ed('editor.action.startFindReplace') },
      { label: 'Find in Files', keybinding: kb('app.view.search'), action: () => api.showView('search') },
      { separator: true },
      { label: 'Toggle Line Comment', keybinding: 'Ctrl+/', disabled: need, action: ed('editor.action.commentLine') },
      { label: 'Format Document', keybinding: 'Shift+Alt+F', disabled: need, action: ed('editor.action.formatDocument') },
    ],
    view: [
      { label: 'Command Palette...', keybinding: kb('app.commandPalette'), action: api.commandPalette },
      { separator: true },
      { label: 'Explorer', keybinding: kb('app.view.explorer'), action: () => api.showView('explorer') },
      { label: 'Search', keybinding: kb('app.view.search'), action: () => api.showView('search') },
      { label: 'Source Control', keybinding: kb('app.view.scm'), action: () => api.showView('scm') },
      { label: 'Extensions', keybinding: kb('app.view.extensions'), action: () => api.showView('extensions') },
      { label: 'Problems', keybinding: kb('app.view.toggleProblems'), action: api.toggleProblems },
      { separator: true },
      { label: 'Toggle Sidebar', keybinding: kb('app.view.toggleSidebar'), action: api.toggleSidebar },
      { label: 'Toggle Minimap', action: api.toggleMinimap },
      { label: 'Toggle Word Wrap', action: api.toggleWordWrap },
      { separator: true },
      { label: 'Change Theme', action: api.changeTheme },
    ],
    go: [
      { label: 'Go to File...', keybinding: kb('app.file.quickOpen'), action: api.quickOpen },
      { label: 'Go to Line/Column...', keybinding: 'Ctrl+G', disabled: need, action: ed('editor.action.gotoLine') },
      { label: 'Go to Symbol in Editor...', keybinding: 'Ctrl+Shift+O', disabled: need, action: ed('editor.action.quickOutline') },
      { separator: true },
      { label: 'Go to Definition', keybinding: 'F12', disabled: need, action: ed('editor.action.revealDefinition') },
    ],
    help: [
      { label: 'Welcome', action: api.showWelcome },
      { label: 'Show All Commands', keybinding: kb('app.commandPalette'), action: api.commandPalette },
      { separator: true },
      { label: 'Settings', action: api.openSettings },
      { separator: true },
      { label: 'About Zern', action: api.showAbout },
    ],
  };
}

function openMenu(btn) {
  const name = btn.dataset.menu;
  // Same button again = close, like a native menu bar
  if (openMenuName === name && document.querySelector('.context-menu')) {
    closeContextMenu();
    openMenuName = null;
    btn.classList.remove('open');
    return;
  }
  closeContextMenu();
  document.querySelectorAll('.menu-btn.open').forEach((b) => b.classList.remove('open'));
  const rect = btn.getBoundingClientRect();
  openMenuName = name;
  btn.classList.add('open');
  showContextMenu(rect.left, rect.bottom, buildMenus()[name]);
  // Highlight follows the menu: when it closes (item chosen / click away) clear it
  const watcher = setInterval(() => {
    if (!document.querySelector('.context-menu')) {
      clearInterval(watcher);
      if (openMenuName === name) { openMenuName = null; btn.classList.remove('open'); btn.blur(); }
    }
  }, 120);
}

export function updateCommandCenterLabel(text) {
  const el = document.getElementById('command-center-label');
  if (el) el.textContent = text || 'Zern';
}

export function initTitleBar(handlers) {
  api = handlers;
  const bar = document.getElementById('title-bar');
  if (!bar) return;

  bar.querySelectorAll('.menu-btn').forEach((btn) => {
    btn.addEventListener('click', () => openMenu(btn));
    // With a menu already open, just hovering another title switches to it
    btn.addEventListener('mouseenter', () => {
      if (document.querySelector('.context-menu') && openMenuName && openMenuName !== btn.dataset.menu) openMenu(btn);
    });
  });

  document.getElementById('command-center').addEventListener('click', () => api.quickOpen());
  document.getElementById('title-toggle-sidebar').addEventListener('click', () => api.toggleSidebar());
  document.getElementById('title-settings').addEventListener('click', () => api.openSettings());

}

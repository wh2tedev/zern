// ============================================================
// app.js - Orchestrator: state, db, explorer, editor, notifs,
// real Monaco commands, file watcher
// ============================================================

import { AppState, loadConfig, saveConfig } from './state.js';
import { verifyPermission, getRecentFolders, removeRecentFolder, getVirtualFileSystem } from './db.js';
import {
  renderExplorer, pickRealDirectory, openRecentFolder, createNewFileAtRoot,
  createNewFolderAtRoot, setExplorerContainer,
} from './explorer.js';
import {
  initEditor, updateEditorConfig, saveFile, saveAllFiles, forceCloseTab,
  reloadFileFromDisk, registerAppAction,
} from './editor.js';
import { showToast } from './notifications.js';
import { startFileWatcher } from './file-watcher.js';
import { initSearchPanel, focusSearchInput } from './search.js';
import { THEMES, THEME_ORDER, resolveInitialTheme } from './themes.js';
import { exportProjectAsZip, importProjectFromZip } from './project-io.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  explorerRoot: $('#explorer-root'),
  noFolderMsg: $('#no-folder-message'),
  btnOpenFolder: $('#btn-open-folder'),
  btnNewFile: $('#btn-new-file'),
  btnNewFolder: $('#btn-new-folder'),
  btnOpenFolderMain: $('#btn-open-folder-main'),
  btnVirtualFs: $('#btn-virtual-fs'),
  btnExportZip: $('#btn-export-zip'),
  btnImportZip: $('#btn-import-zip'),
  recentFoldersSection: $('#recent-folders-section'),
  recentFoldersList: $('#recent-folders-list'),
  explorerTitle: $('#explorer-title'),
  tabsBar: $('#tabs-bar'),
  editorHost: $('#editor-host'),
  imagePreviewHost: $('#image-preview-host'),
  statusFsMode: $('#status-fs-mode'),
  statusCursor: $('#status-cursor-pos'),
  statusLanguage: $('#status-language'),
  statusAutosave: $('#status-autosave'),
  settingsOverlay: $('#settings-overlay'),
  btnSettings: $('#btn-settings'),
  btnCloseSettings: $('#btn-close-settings'),
  cfgFontSize: $('#cfg-font-size'),
  cfgTabSize: $('#cfg-tab-size'),
  cfgWordWrap: $('#cfg-word-wrap'),
  cfgMinimap: $('#cfg-minimap'),
  cfgAutoSave: $('#cfg-auto-save'),
  themePicker: $('#theme-picker'),
  cfgUiFont: $('#cfg-ui-font'),
  cfgCursorStyle: $('#cfg-cursor-style'),
  cfgLineHeight: $('#cfg-line-height'),
  cfgRenderWhitespace: $('#cfg-render-whitespace'),
  cfgBracketColorization: $('#cfg-bracket-colorization'),
  cfgSmoothScrolling: $('#cfg-smooth-scrolling'),
  cfgFormatOnSave: $('#cfg-format-on-save'),
  sidebarResizer: $('#sidebar-resizer'),
  sideBar: $('#side-bar'),
  viewExplorer: $('#view-explorer'),
  viewSearch: $('#view-search'),
  searchInput: $('#search-input'),
  searchResults: $('#search-results'),
  searchSummary: $('#search-summary'),
  searchClear: $('#search-clear'),
  searchReplaceInput: $('#search-replace-input'),
  searchReplaceAll: $('#search-replace-all'),
};

async function bootstrap() {
  loadConfig();
  setExplorerContainer(els.explorerRoot);

  await initEditor({ editorHost: els.editorHost, tabsHost: els.tabsBar, imagePreviewHost: els.imagePreviewHost });

  syncSettingsPanelFromState();
  await tryRestoreSession();

  wireExplorerButtons();
  wireSettingsPanel();
  wireStatusBar();
  wireSidebarResizer();
  wireActivityBar();

  initSearchPanel({
    input: els.searchInput,
    results: els.searchResults,
    summary: els.searchSummary,
    clear: els.searchClear,
    replaceInput: els.searchReplaceInput,
    replaceAll: els.searchReplaceAll,
  });

  registerAllCommands();

  startFileWatcher({
    onDeleted: (path, file) => {
      forceCloseTab(path);
      showToast({ type: 'warning', title: 'File deleted', message: `"${file.name}" no longer exists on disk. The tab was closed.` });
    },
    onExternalChange: (path, file, conflict) => {
      if (conflict) {
        showToast({ type: 'warning', title: 'Edit conflict', message: `"${file.name}" changed on disk and has unsaved changes here.` });
      } else {
        showToast({
          type: 'info', title: 'External change detected', message: `"${file.name}" changed on disk.`,
          actionLabel: 'Reload', onAction: () => reloadFileFromDisk(path), timeout: 8000,
        });
      }
    },
  });

  updateFsModeLabel();
}

// Tries, in order: (1) reopen the most recently used real folder if
// permission is still granted, (2) restore the persisted virtual
// project if one was saved, (3) fall back to the sample virtual
// project. Either way, the recent folders list is always rendered so
// the user can pick a different one.
async function tryRestoreSession() {
  try {
    const recents = await getRecentFolders();
    await renderRecentFoldersList(recents);

    if (recents.length) {
      const mostRecent = recents[0];
      const permissionState = await mostRecent.handle.queryPermission({ mode: 'readwrite' });
      if (permissionState === 'granted') {
        AppState.rootDirHandle = mostRecent.handle;
        AppState.isRealFS = true;
        await renderExplorer(els.explorerRoot);
        showExplorerTree();
        updateExplorerTitle();
        return;
      }
    }

    const savedVirtualTree = await getVirtualFileSystem();
    if (savedVirtualTree) {
      AppState.fileSystem = savedVirtualTree;
    }
    showNoFolderMessage();
  } catch (err) {
    console.warn('Could not restore the previous session:', err);
    showNoFolderMessage();
  }
}

async function renderRecentFoldersList(recents) {
  els.recentFoldersList.innerHTML = '';
  if (!recents.length) {
    els.recentFoldersSection.style.display = 'none';
    return;
  }
  els.recentFoldersSection.style.display = 'block';

  recents.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'recent-folder-item';

    const icon = document.createElement('span');
    icon.className = 'recent-folder-icon';
    icon.innerHTML = '<i class="codicon codicon-folder"></i>';

    const name = document.createElement('span');
    name.className = 'recent-folder-name';
    name.textContent = entry.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'recent-folder-remove';
    removeBtn.title = 'Remove from recent folders';
    removeBtn.innerHTML = '<i class="codicon codicon-close"></i>';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeRecentFolder(entry.name);
      const updated = await getRecentFolders();
      await renderRecentFoldersList(updated);
    });

    li.appendChild(icon);
    li.appendChild(name);
    li.appendChild(removeBtn);

    li.addEventListener('click', async () => {
      const ok = await openRecentFolder(entry.handle);
      if (ok) { showExplorerTree(); updateFsModeLabel(); updateExplorerTitle(); }
    });

    els.recentFoldersList.appendChild(li);
  });
}

function wireExplorerButtons() {
  const openFolderHandler = async () => {
    const ok = await pickRealDirectory();
    if (ok) { showExplorerTree(); updateFsModeLabel(); updateExplorerTitle(); }
  };

  els.btnOpenFolder.addEventListener('click', openFolderHandler);
  els.btnOpenFolderMain.addEventListener('click', openFolderHandler);
  els.btnNewFile.addEventListener('click', () => createNewFileAtRoot());
  els.btnNewFolder.addEventListener('click', () => createNewFolderAtRoot());

  els.btnVirtualFs.addEventListener('click', async () => {
    AppState.isRealFS = false;
    AppState.rootDirHandle = null;
    await renderExplorer(els.explorerRoot);
    showExplorerTree();
    updateFsModeLabel();
    updateExplorerTitle();
  });

  els.btnExportZip.addEventListener('click', () => exportProjectAsZip());
  els.btnImportZip.addEventListener('click', async () => {
    const imported = await importProjectFromZip();
    if (imported) {
      await renderExplorer(els.explorerRoot);
      showExplorerTree();
      updateFsModeLabel();
      updateExplorerTitle();
    }
  });
}

function showExplorerTree() { els.noFolderMsg.style.display = 'none'; els.explorerRoot.style.display = 'block'; }
function showNoFolderMessage() { els.noFolderMsg.style.display = 'block'; els.explorerRoot.style.display = 'none'; }
function updateFsModeLabel() {
  els.statusFsMode.innerHTML = AppState.isRealFS
    ? '<i class="codicon codicon-folder-opened"></i> Real folder (FS Access)'
    : '<i class="codicon codicon-database"></i> Virtual filesystem';
}

// Mirrors real VS Code: the Explorer section header shows the open
// folder's name (uppercase) instead of a generic "Explorer" label -
// this is what makes the root folder "visible" without turning it
// into its own tree row (which would mean restructuring the tree
// rendering logic in explorer.js).
function updateExplorerTitle() {
  if (!els.explorerTitle) return;
  els.explorerTitle.textContent = (AppState.isRealFS && AppState.rootDirHandle)
    ? AppState.rootDirHandle.name.toUpperCase()
    : 'Explorer';
}

let activeThemeKey = 'dark-2026';

function syncSettingsPanelFromState() {
  const cfg = AppState.config;
  els.cfgFontSize.value = cfg.fontSize;
  els.cfgTabSize.value = cfg.tabSize;
  els.cfgWordWrap.checked = cfg.wordWrap === 'on';
  els.cfgMinimap.checked = cfg.minimap;
  els.cfgAutoSave.checked = cfg.autoSave;
  els.cfgCursorStyle.value = cfg.cursorStyle || 'line';
  els.cfgLineHeight.value = cfg.lineHeight || 0;
  els.cfgRenderWhitespace.value = cfg.renderWhitespace || 'selection';
  els.cfgBracketColorization.checked = cfg.bracketPairColorization !== false;
  els.cfgSmoothScrolling.checked = !!cfg.smoothScrolling;
  els.cfgFormatOnSave.checked = !!cfg.formatOnSave;
  els.cfgUiFont.value = cfg.uiFont || 'system';
  els.statusAutosave.textContent = `Autosave: ${cfg.autoSave ? 'ON' : 'OFF'}`;

  buildThemePicker();
  const themeKey = resolveInitialTheme(cfg);
  applyTheme(themeKey);
  applyUiFont(cfg.uiFont || 'system');
}

function applyTheme(themeKey) {
  if (!THEMES[themeKey]) return;
  activeThemeKey = themeKey;
  document.body.dataset.theme = themeKey;
  updateThemePickerActiveState(themeKey);
}

const UI_FONT_STACKS = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Ubuntu, sans-serif",
  inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'Consolas', 'Courier New', monospace",
  serif: "Georgia, 'Times New Roman', serif",
};

function applyUiFont(key) {
  document.documentElement.style.setProperty('--font-ui', UI_FONT_STACKS[key] || UI_FONT_STACKS.system);
}

// Builds the theme picker as a grid of color-swatch buttons (instead
// of a plain <select>), so each theme can be visually previewed
// before picking it - the swatch colors come straight from the
// THEMES registry in themes.js.
function buildThemePicker() {
  if (!els.themePicker) return;
  els.themePicker.innerHTML = '';

  THEME_ORDER.forEach((key) => {
    const theme = THEMES[key];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-swatch-btn';
    btn.dataset.theme = key;
    btn.title = theme.label;

    const preview = document.createElement('span');
    preview.className = 'theme-swatch-preview';
    preview.style.background = theme.swatch[0];
    [1, 2, 3].forEach((i) => {
      const dot = document.createElement('span');
      dot.className = 'swatch-dot';
      dot.style.background = theme.swatch[i];
      preview.appendChild(dot);
    });

    const label = document.createElement('span');
    label.className = 'theme-swatch-label';
    label.textContent = theme.label;

    btn.appendChild(preview);
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      applyTheme(key);
      updateEditorConfig({ theme: key });
    });

    els.themePicker.appendChild(btn);
  });
}

function updateThemePickerActiveState(activeKey) {
  if (!els.themePicker) return;
  els.themePicker.querySelectorAll('.theme-swatch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === activeKey);
  });
}

function wireSettingsPanel() {
  els.btnSettings.addEventListener('click', () => els.settingsOverlay.classList.add('open'));
  els.btnCloseSettings.addEventListener('click', () => els.settingsOverlay.classList.remove('open'));
  els.settingsOverlay.addEventListener('click', (e) => { if (e.target === els.settingsOverlay) els.settingsOverlay.classList.remove('open'); });

  els.cfgFontSize.addEventListener('change', () => {
    const value = Math.min(40, Math.max(8, parseInt(els.cfgFontSize.value, 10) || 14));
    els.cfgFontSize.value = value;
    updateEditorConfig({ fontSize: value });
  });
  els.cfgTabSize.addEventListener('change', () => {
    const value = Math.min(8, Math.max(1, parseInt(els.cfgTabSize.value, 10) || 4));
    els.cfgTabSize.value = value;
    updateEditorConfig({ tabSize: value });
  });
  els.cfgWordWrap.addEventListener('change', () => updateEditorConfig({ wordWrap: els.cfgWordWrap.checked ? 'on' : 'off' }));
  els.cfgMinimap.addEventListener('change', () => updateEditorConfig({ minimap: els.cfgMinimap.checked }));
  els.cfgAutoSave.addEventListener('change', () => {
    updateEditorConfig({ autoSave: els.cfgAutoSave.checked });
    els.statusAutosave.textContent = `Autosave: ${els.cfgAutoSave.checked ? 'ON' : 'OFF'}`;
  });
  els.cfgUiFont.addEventListener('change', () => {
    applyUiFont(els.cfgUiFont.value);
    AppState.config.uiFont = els.cfgUiFont.value;
    saveConfig();
  });
  els.cfgCursorStyle.addEventListener('change', () => updateEditorConfig({ cursorStyle: els.cfgCursorStyle.value }));
  els.cfgLineHeight.addEventListener('change', () => {
    const value = Math.min(60, Math.max(0, parseInt(els.cfgLineHeight.value, 10) || 0));
    els.cfgLineHeight.value = value;
    updateEditorConfig({ lineHeight: value });
  });
  els.cfgRenderWhitespace.addEventListener('change', () => updateEditorConfig({ renderWhitespace: els.cfgRenderWhitespace.value }));
  els.cfgBracketColorization.addEventListener('change', () => updateEditorConfig({ bracketPairColorization: els.cfgBracketColorization.checked }));
  els.cfgSmoothScrolling.addEventListener('change', () => updateEditorConfig({ smoothScrolling: els.cfgSmoothScrolling.checked }));
  els.cfgFormatOnSave.addEventListener('change', () => updateEditorConfig({ formatOnSave: els.cfgFormatOnSave.checked }));
}

function wireStatusBar() {
  const editor = AppState.editorInstance;
  if (!editor) return;
  editor.onDidChangeCursorPosition((e) => {
    els.statusCursor.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });
  editor.onDidChangeModel(() => {
    const model = editor.getModel();
    els.statusLanguage.textContent = model ? model.getLanguageId() : 'plaintext';
  });
}

function wireSidebarResizer() {
  let dragging = false;
  els.sidebarResizer.addEventListener('mousedown', () => {
    dragging = true;
    els.sidebarResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const activityBarWidth = 48;
    const newWidth = Math.min(500, Math.max(170, e.clientX - activityBarWidth));
    els.sideBar.style.width = `${newWidth}px`;
  });
  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      els.sidebarResizer.classList.remove('dragging');
      document.body.style.cursor = '';
      AppState.editorInstance && AppState.editorInstance.layout();
    }
  });
}

let currentSidebarView = 'explorer';

function wireActivityBar() {
  const explorerBtn = document.querySelector('.activity-btn[data-view="explorer"]');
  const searchBtn = document.querySelector('.activity-btn[data-view="search"]');

  const activateView = (view, btn) => {
    const sameViewAlreadyOpen = currentSidebarView === view && !els.sideBar.classList.contains('collapsed');

    if (sameViewAlreadyOpen) {
      // Clicking the already-active icon collapses the sidebar (animated)
      els.sideBar.classList.add('collapsed');
      els.sidebarResizer.classList.add('collapsed');
      btn.classList.remove('active');
    } else {
      // Opens the sidebar (if it was collapsed) and shows the requested view
      els.sideBar.classList.remove('collapsed');
      els.sidebarResizer.classList.remove('collapsed');
      currentSidebarView = view;
      els.viewExplorer.style.display = view === 'explorer' ? 'flex' : 'none';
      els.viewSearch.style.display = view === 'search' ? 'flex' : 'none';

      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (view === 'search') {
        setTimeout(() => focusSearchInput(), 240);
      }
    }

    // Wait for the CSS transition to finish before re-laying out Monaco
    setTimeout(() => AppState.editorInstance && AppState.editorInstance.layout(), 240);
  };

  explorerBtn.addEventListener('click', () => activateView('explorer', explorerBtn));
  searchBtn.addEventListener('click', () => activateView('search', searchBtn));
}

// Every app command is now a REAL Monaco action: it shows up in its
// native Command Palette (Ctrl+Q) instead of a custom-built one.
function registerAllCommands() {
  registerAppAction({ id: 'app.file.save', label: 'File: Save', run: () => AppState.activeFilePath && saveFile(AppState.activeFilePath) });
  registerAppAction({ id: 'app.file.saveAll', label: 'File: Save All', run: () => saveAllFiles() });
  registerAppAction({ id: 'app.file.newFile', label: 'File: New File (root)', run: () => createNewFileAtRoot() });
  registerAppAction({ id: 'app.file.newFolder', label: 'File: New Folder (root)', run: () => createNewFolderAtRoot() });
  registerAppAction({ id: 'app.folder.open', label: 'Folder: Open Folder...', run: () => els.btnOpenFolderMain.click() });
  registerAppAction({ id: 'app.folder.virtual', label: 'Folder: Use Virtual Filesystem', run: () => els.btnVirtualFs.click() });
  registerAppAction({ id: 'app.project.exportZip', label: 'Project: Export as ZIP', run: () => exportProjectAsZip() });
  registerAppAction({ id: 'app.project.importZip', label: 'Project: Import from ZIP', run: () => els.btnImportZip.click() });
  registerAppAction({ id: 'app.editor.find', label: 'Editor: Find', run: () => AppState.editorInstance && AppState.editorInstance.getAction('actions.find').run() });
  registerAppAction({ id: 'app.view.toggleSidebar', label: 'View: Toggle Sidebar', run: () => els.sideBar.classList.toggle('collapsed') });
  registerAppAction({ id: 'app.view.toggleMinimap', label: 'View: Toggle Minimap', run: () => { els.cfgMinimap.checked = !els.cfgMinimap.checked; els.cfgMinimap.dispatchEvent(new Event('change')); } });
  registerAppAction({ id: 'app.view.toggleWordWrap', label: 'View: Toggle Word Wrap', run: () => { els.cfgWordWrap.checked = !els.cfgWordWrap.checked; els.cfgWordWrap.dispatchEvent(new Event('change')); } });
  registerAppAction({ id: 'app.view.toggleTheme', label: 'Preferences: Change Theme', run: () => {
    const currentIndex = THEME_ORDER.indexOf(activeThemeKey);
    const nextTheme = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
    applyTheme(nextTheme);
    updateEditorConfig({ theme: nextTheme });
    showToast({ type: 'info', message: `Theme: ${THEMES[nextTheme].label}`, timeout: 1800 });
  } });
  registerAppAction({ id: 'app.preferences.open', label: 'Preferences: Open Settings', run: () => els.settingsOverlay.classList.add('open') });
}

// On phones the sidebar is a full-screen drawer (see mobile.css), so
// there's no room to see both the tree and the open file at once.
// Closing it automatically once a file is opened is what makes this
// actually usable one-handed - on desktop/tablet this media query
// never matches, so nothing changes there.
const MOBILE_BREAKPOINT = '(max-width: 600px)';
document.addEventListener('kcode:file-opened', () => {
  if (!window.matchMedia(MOBILE_BREAKPOINT).matches) return;
  if (els.sideBar.classList.contains('collapsed')) return;

  els.sideBar.classList.add('collapsed');
  els.sidebarResizer.classList.add('collapsed');
  document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
  setTimeout(() => AppState.editorInstance && AppState.editorInstance.layout(), 240);
});

document.addEventListener('DOMContentLoaded', bootstrap);
window.addEventListener('error', (e) => console.error('Uncaught error:', e.error || e.message));

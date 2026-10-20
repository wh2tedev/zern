// ============================================================
// app.js - Orchestrator: state, db, explorer, editor, notifs,
// real Monaco commands, file watcher
// ============================================================

import { AppState, loadConfig, saveConfig } from './state.js';
import { verifyPermission, getRecentFolders, removeRecentFolder, getVirtualFileSystem } from './db.js';
import {
  renderExplorer, pickRealDirectory, openRecentFolder, createNewFileAtRoot,
  createNewFolderAtRoot, setExplorerContainer, openRealFile,
} from './explorer.js';
import {
  initEditor, updateEditorConfig, saveFile, saveAllFiles, forceCloseTab,
  reloadFileFromDisk, registerAppAction, openFileInEditor, activateOpenTab, openCommandPalette, getMonacoNS,
} from './editor.js';
import { restoreSession, beginSession, getLastRootId, getSavedTabCount, flushAndPauseSession } from './session.js';
import { showToast } from './notifications.js';
import { startFileWatcher } from './file-watcher.js';
import { initSearchPanel, focusSearchInput } from './search.js';
import { THEMES, THEME_ORDER, resolveInitialTheme } from './themes.js';
import { exportProjectAsZip, importProjectFromZip } from './project-io.js';
import { initQuickOpen, openQuickOpen } from './quick-open.js';
import { initLanding, showLanding } from './landing.js';
import {
  initGithub, setGithubHooks, restoreLastWorkspace, detachRepository, closeRepository, flushWorkspaceNow, refreshNow,
} from './github.js';
import { initScmPanel, showRepoPicker, branchPicker, doPull, signOut } from './scm-panel.js';
import { initProblems, toggleProblemsPanel } from './problems.js';
import { initSafety } from './safety.js';
import { showAbout } from './about.js';
import { setSemanticValidation } from './intellisense.js';
import { initTitleBar, updateCommandCenterLabel } from './titlebar.js';
import { updateLogoTheme } from './logo.js';
import { initExtensionsView } from './extensions/view.js';
import { initKeybindings } from './keybindings.js';
import { setSidebarHost } from './extensions/ui.js';
import { initSecureToken, takeMigrationNotice } from './secure-token.js';
import { APP_VERSION } from './version.js';
import { initWindowControls } from './window-controls.js';
import { openKeyboardShortcuts } from './keybindings-ui.js';
import { openSettingsJson, initSettingsJson } from './settings-json.js';
import { startInstalled as startExtensions } from './extensions/manager.js';
import { escapeHtml } from './escape.js';

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
  cfgAutoCloseTags: $('#cfg-auto-close-tags'),
  cfgSemantic: $('#cfg-semantic-validation'),
  cfgSmoothScrolling: $('#cfg-smooth-scrolling'),
  cfgFormatOnSave: $('#cfg-format-on-save'),
  sidebarResizer: $('#sidebar-resizer'),
  sideBar: $('#side-bar'),
  viewExplorer: $('#view-explorer'),
  viewSearch: $('#view-search'),
  viewScm: $('#view-scm'),
  viewExtensions: $('#view-extensions'),
  extPageHost: $('#ext-page-host'),
  scmBadge: $('#scm-badge'),
  statusBranch: $('#status-branch'),
  btnOpenGithub: $('#btn-open-github'),
  searchInput: $('#search-input'),
  searchResults: $('#search-results'),
  searchSummary: $('#search-summary'),
  searchClear: $('#search-clear'),
  searchReplaceInput: $('#search-replace-input'),
  searchReplaceAll: $('#search-replace-all'),
  quickOpenOverlay: $('#quick-open-overlay'),
  quickOpenInput: $('#quick-open-input'),
  quickOpenList: $('#quick-open-list'),
};

async function bootstrap() {
  // A stale cache can leave the page from one release and the scripts from another; say so instead of misbehaving silently
  const pageVersion = (document.querySelector('meta[name="zern-version"]') || {}).content;
  if (pageVersion && pageVersion !== APP_VERSION) {
    showToast({ type: 'warning', title: 'Mixed versions loaded', message: `The page is ${pageVersion} but the scripts are ${APP_VERSION}. Reload with Ctrl+Shift+R to clear the cache.`, timeout: 0 });
  }
  initKeybindings(); // one listener runs the global shortcuts (customizable in Keyboard Shortcuts)
  await initSecureToken(); // the GitHub token lives in the OS keyring / session, never in plain localStorage
  const moved = takeMigrationNotice();
  if (moved) showToast({ type: 'info', title: 'GitHub token protected', message: moved === 'keyring' ? 'Your saved GitHub token moved to your system keyring.' : 'Your saved GitHub token is no longer stored as plain text. It is kept for this session; reconnect and tick "Remember" to keep it encrypted.', timeout: 9000 });
  initWindowControls(); // minimize / maximize / close, only inside the desktop app
  initLanding(); // first so its buttons work even if the editor engine fails to load
  initSafety();
  loadConfig();
  wireGithub();
  setExplorerContainer(els.explorerRoot);
  registerServiceWorker();

  // Extensions: the view and the installed extensions start before the editor (their commands queue until it is ready)
  initExtensionsView({ container: els.viewExtensions, pageHost: els.extPageHost });
  startExtensions();

  try {
    await initEditor({ editorHost: els.editorHost, tabsHost: els.tabsBar, imagePreviewHost: els.imagePreviewHost });
  } catch (err) {
    console.error('Monaco failed to load:', err);
    showEditorLoadError();
    return; // don't continue bootstrapping the rest of a half-initialized app
  }

  syncSettingsPanelFromState();
  await tryRestoreSession();

  wireExplorerButtons();
  wireSettingsPanel();
  initProblems(getMonacoNS());
  wireStatusBar();
  wireTitleBar();
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

  initQuickOpen({
    overlay: els.quickOpenOverlay,
    input: els.quickOpenInput,
    list: els.quickOpenList,
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

  // Last step: bring back the tabs (with cursor/scroll) from the previous
  // visit. Done after all the wiring above so the status bar, file watcher
  // and commands already react to the restored files.
  await restoreTabsForCurrentRoot();
}

// Identifies the project currently shown in the Explorer, or null when the
// "No folder opened" message is showing (nothing to restore tabs into).
function getCurrentRootId() {
  if (AppState.github) return AppState.github.id;
  if (AppState.isRealFS && AppState.rootDirHandle) return `real:${AppState.rootDirHandle.name}`;
  if (els.explorerRoot.style.display !== 'none') return 'virtual';
  return null;
}

// Re-opens the tabs saved for the current project, then turns session
// saving on for it. When switching projects while tabs from the previous
// one are still open, nothing is restored (and saving keeps belonging to
// the previous project) so the two sets of tabs never get mixed up.
async function restoreTabsForCurrentRoot() {
  const rootId = getCurrentRootId();
  if (!rootId || AppState.openFiles.size > 0) return;

  try {
    await restoreSession(rootId, { openRealFile, openFileInEditor, activateTab: activateOpenTab });
  } catch (err) {
    console.warn('Could not restore the previous tabs:', err);
  }
  beginSession(rootId);
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

    // Last thing you used was a GitHub repository: put it (and its uncommitted changes) back
    if (await restoreLastWorkspace()) {
      refreshNow();
      await renderExplorer(els.explorerRoot);
      showExplorerTree();
      updateExplorerTitle();
      return;
    }

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

    // If the last thing you were working on was the virtual project (with
    // tabs open), go straight back into it instead of making you click
    // "Use the virtual filesystem" again. Otherwise behave as always.
    if (getLastRootId() === 'virtual' && getSavedTabCount('virtual') > 0) {
      await renderExplorer(els.explorerRoot);
      showExplorerTree();
      return;
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
    icon.innerHTML = '<i class="zi zi-folder"></i>';

    const name = document.createElement('span');
    name.className = 'recent-folder-name';
    name.textContent = entry.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'recent-folder-remove';
    removeBtn.title = 'Remove from recent folders';
    removeBtn.innerHTML = '<i class="zi zi-close"></i>';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await removeRecentFolder(entry.name);
        const updated = await getRecentFolders();
        await renderRecentFoldersList(updated);
      } catch (err) {
        console.warn('Could not update the recent folders list:', err);
        showToast({ type: 'error', message: 'Could not update the recent folders list.' });
      }
    });

    li.appendChild(icon);
    li.appendChild(name);
    li.appendChild(removeBtn);

    li.addEventListener('click', async () => {
      await saveRepoBeforeLeaving();
      const wasGithub = !!AppState.github;
      const ok = await openRecentFolder(entry.handle);
      if (ok) { if (wasGithub) await leaveRepoForOtherProject(); showExplorerTree(); updateFsModeLabel(); updateExplorerTitle(); await restoreTabsForCurrentRoot(); }
    });

    els.recentFoldersList.appendChild(li);
  });
}

function wireExplorerButtons() {
  const openFolderHandler = async () => {
    await saveRepoBeforeLeaving();
    const wasGithub = !!AppState.github;
    const ok = await pickRealDirectory();
    if (ok) { if (wasGithub) await leaveRepoForOtherProject(); showExplorerTree(); updateFsModeLabel(); updateExplorerTitle(); await restoreTabsForCurrentRoot(); }
  };

  els.btnOpenFolder.addEventListener('click', openFolderHandler);
  els.btnOpenFolderMain.addEventListener('click', openFolderHandler);
  els.btnNewFile.addEventListener('click', () => createNewFileAtRoot());
  els.btnNewFolder.addEventListener('click', () => createNewFolderAtRoot());

  els.btnVirtualFs.addEventListener('click', async () => {
    if (AppState.github) { await closeRepository(); return; } // back to the scratch project
    AppState.isRealFS = false;
    AppState.rootDirHandle = null;
    await renderExplorer(els.explorerRoot);
    showExplorerTree();
    updateFsModeLabel();
    updateExplorerTitle();
    await restoreTabsForCurrentRoot();
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
  if (AppState.github) {
    els.statusFsMode.innerHTML = `<i class="zi zi-github"></i> ${escapeHtml(AppState.github.owner)}/${escapeHtml(AppState.github.repo)}`;
    return;
  }
  els.statusFsMode.innerHTML = AppState.isRealFS
    ? '<i class="zi zi-folder-opened"></i> Real folder (FS Access)'
    : '<i class="zi zi-database"></i> Virtual filesystem';
}

// Registers the Service Worker (offline app shell caching) and shows
// a "reload to update" prompt when a new version has been installed
// in the background - important now that we're versioning releases.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller; // false on the very first visit

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            // Only a real update announces itself; the first install is silent
            if (newWorker.state === 'activated' && hadController) {
              showToast({
                type: 'info',
                message: 'A new version of Zern is ready.',
                actionLabel: 'Reload',
                onAction: () => window.location.reload(),
                timeout: 0,
              });
            }
          });
        });
        // Once the app is up, cache the editor engine in the background so Zern also opens offline
        navigator.serviceWorker.ready.then((reg) => {
          setTimeout(() => { if (reg.active) reg.active.postMessage({ type: 'warm-vendor' }); }, 2000);
        });
      })
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}

function showEditorLoadError() {
  if (!els.editorHost) return;
  els.editorHost.classList.remove('editor-empty');
  els.editorHost.innerHTML = `
    <div class="editor-load-error">
      <i class="zi zi-error"></i>
      <h2>Zern couldn't load its editor engine</h2>
      <p>This usually means there's no internet connection and no local copy of Monaco was found (see assets/vendor/monaco-editor/README.md).</p>
      <button type="button" id="btn-retry-editor-load" class="btn-primary">Retry</button>
    </div>`;
  document.getElementById('btn-retry-editor-load')?.addEventListener('click', () => window.location.reload());
}

// Mirrors real VS Code: the Explorer section header shows the open
// folder's name (uppercase) instead of a generic "Explorer" label -
// this is what makes the root folder "visible" without turning it
// into its own tree row (which would mean restructuring the tree
// rendering logic in explorer.js).
function updateExplorerTitle() {
  if (AppState.github) {
    updateCommandCenterLabel(`${AppState.github.owner}/${AppState.github.repo}`);
    if (els.explorerTitle) els.explorerTitle.textContent = AppState.github.repo.toUpperCase();
    return;
  }
  updateCommandCenterLabel((AppState.isRealFS && AppState.rootDirHandle) ? AppState.rootDirHandle.name : 'Zern');
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
  els.cfgAutoCloseTags.checked = cfg.autoCloseTags !== false;
  els.cfgSemantic.checked = cfg.semanticValidation === true;
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
  updateLogoTheme();
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
    refreshStatusExtras();
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
  els.cfgAutoCloseTags.addEventListener('change', () => updateEditorConfig({ autoCloseTags: els.cfgAutoCloseTags.checked }));
  els.cfgSemantic.addEventListener('change', () => {
    updateEditorConfig({ semanticValidation: els.cfgSemantic.checked });
    setSemanticValidation(els.cfgSemantic.checked);
  });
  els.cfgSmoothScrolling.addEventListener('change', () => updateEditorConfig({ smoothScrolling: els.cfgSmoothScrolling.checked }));
  els.cfgFormatOnSave.addEventListener('change', () => updateEditorConfig({ formatOnSave: els.cfgFormatOnSave.checked }));

  document.getElementById('btn-open-shortcuts').addEventListener('click', () => { els.settingsOverlay.classList.remove('open'); openKeyboardShortcuts(); });
  document.getElementById('btn-open-settings-json').addEventListener('click', () => { els.settingsOverlay.classList.remove('open'); openSettingsJson(); });

  // settings.json applies validated values through the same functions the Settings panel uses
  initSettingsJson({
    currentTheme: () => activeThemeKey,
    apply: (v) => {
      const { theme, uiFont, semanticValidation, ...rest } = v;
      if (theme) { applyTheme(theme); updateEditorConfig({ theme }); }
      if (uiFont) { applyUiFont(uiFont); updateEditorConfig({ uiFont }); }
      if (Object.keys(rest).length) updateEditorConfig(rest);
      if (semanticValidation !== undefined) { updateEditorConfig({ semanticValidation }); setSemanticValidation(semanticValidation); }
      syncSettingsPanelFromState();
      refreshStatusExtras();
    },
  });
}

function refreshStatusExtras() {
  const editor = AppState.editorInstance;
  const model = editor && editor.getModel();
  const indent = document.getElementById('status-indent');
  const eol = document.getElementById('status-eol');
  if (indent) indent.textContent = `Spaces: ${AppState.config.tabSize}`;
  if (eol) eol.textContent = model && typeof model.getEOL === 'function' && model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
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
    refreshStatusExtras();
  });
  refreshStatusExtras();

  // Clickable like in VS Code: line/column -> Go to Line, autosave -> toggle
  const press = (el, fn) => {
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  };
  press(els.statusCursor, () => AppState.activeFilePath && runEditorAction('editor.action.gotoLine'));
  press(els.statusAutosave, () => { els.cfgAutoSave.checked = !els.cfgAutoSave.checked; els.cfgAutoSave.dispatchEvent(new Event('change')); });
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
      // Core views (#view-explorer...) and the ones extensions add (#view-ext-<id>) share the same convention
      document.querySelectorAll('.sidebar-view').forEach((v) => { v.style.display = v.id === `view-${view}` ? 'flex' : 'none'; });

      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (view === 'search') {
        setTimeout(() => focusSearchInput(), 240);
      }
      document.dispatchEvent(new CustomEvent('zern:sidebar-view-shown', { detail: view }));
    }

    // Wait for the CSS transition to finish before re-laying out Monaco
    setTimeout(() => AppState.editorInstance && AppState.editorInstance.layout(), 240);
  };

  const scmBtn = document.querySelector('.activity-btn[data-view="scm"]');
  explorerBtn.addEventListener('click', () => activateView('explorer', explorerBtn));
  searchBtn.addEventListener('click', () => activateView('search', searchBtn));
  scmBtn.addEventListener('click', () => activateView('scm', scmBtn));
  const extBtn = document.querySelector('.activity-btn[data-view="extensions"]');
  extBtn.addEventListener('click', () => activateView('extensions', extBtn));
  setSidebarHost({ activate: activateView, show: showSidebarView }); // views added by extensions
}

// Opens/closes the side bar exactly like clicking the active Activity Bar icon.
function toggleSidebar() {
  const btn = document.querySelector(`.activity-btn[data-view="${currentSidebarView}"]`);
  if (!btn) return;
  btn.click(); // collapsed -> reopens the view that was showing; open -> collapses it
}

// Shows a side bar view (explorer/search), opening the side bar if needed.
function showSidebarView(view) {
  const btn = document.querySelector(`.activity-btn[data-view="${view}"]`);
  if (!btn) return;
  const visible = currentSidebarView === view && !els.sideBar.classList.contains('collapsed');
  if (!visible) btn.click();
  else if (view === 'search') focusSearchInput();
}

function runEditorAction(id) {
  const editor = AppState.editorInstance;
  if (!editor) return;
  editor.focus();
  const action = editor.getAction && editor.getAction(id);
  if (action) action.run();
  else editor.trigger('menu', id, null); // undo / redo are handlers, not actions
}

// ---------------- GitHub ----------------

// Opens the Source Control view on the repository picker (or the sign-in form).
async function openGithubRepository() {
  showSidebarView('scm');
  await showRepoPicker();
}

// Before leaving a repository for another project, flush edits that autosave hasn't written yet
async function saveRepoBeforeLeaving() {
  if (!AppState.github) return;
  try { await saveAllFiles(); await flushWorkspaceNow(); } catch (err) { console.warn(err); }
}

// A real folder was opened while a repository was active: close the repository's tabs and detach it
async function leaveRepoForOtherProject() {
  flushAndPauseSession();
  for (const path of Array.from(AppState.openFiles.keys())) forceCloseTab(path);
  await detachRepository();
}

async function beforeWorkspaceSwitch() {
  // Write the current project to disk-of-the-browser NOW: a pending debounced save would otherwise
  // run after the switch and store the wrong tree.
  try { await saveAllFiles(); await flushWorkspaceNow(); } catch (err) { console.warn(err); }
  flushAndPauseSession();
  for (const path of Array.from(AppState.openFiles.keys())) forceCloseTab(path);
  return true;
}

async function afterWorkspaceSwitch() {
  await renderExplorer(els.explorerRoot);
  showExplorerTree();
  updateFsModeLabel();
  updateExplorerTitle();
  updateScmStatus();
  document.dispatchEvent(new CustomEvent('zern:workspace-switched'));
  await restoreTabsForCurrentRoot();
  showSidebarView('explorer');
}

// Activity-bar badge (number of changes) and the branch item of the status bar
function updateScmStatus(count) {
  const g = AppState.github;
  const n = count ?? 0;
  els.scmBadge.hidden = !g || !n;
  els.scmBadge.textContent = n > 99 ? '99+' : String(n);
  els.statusBranch.hidden = !g;
  if (g) els.statusBranch.innerHTML = `<i class="zi zi-git-branch"></i> ${escapeHtml(g.branch)}${n ? '*' : ''}`;
}

function wireGithub() {
  setGithubHooks({ beforeSwitch: beforeWorkspaceSwitch, afterSwitch: afterWorkspaceSwitch });
  initGithub();
  initScmPanel(document.getElementById('scm-root'));

  document.addEventListener('zern:scm-changed', (e) => { updateScmStatus(e.detail.changes.length); updateFsModeLabel(); });
  // Pull / discard can add, remove or restore files: redraw the tree
  document.addEventListener('zern:workspace-restructured', () => renderExplorer(els.explorerRoot));

  const press = (el, fn) => {
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  };
  press(els.statusBranch, () => branchPicker());
  const sync = document.getElementById('status-sync');
  press(sync, () => doPull());
  document.addEventListener('zern:scm-remote', (e) => {
    const n = e.detail.behind;
    sync.hidden = !n || !AppState.github;
    if (n) {
      sync.innerHTML = `<i class="zi zi-arrow-down"></i> ${Number(n) || 0}`;
      sync.title = `${n} new commit${n === 1 ? '' : 's'} on GitHub in "${AppState.github.branch}". Click to pull.`;
    }
  });
  els.btnOpenGithub.addEventListener('click', () => openGithubRepository());
}

function wireTitleBar() {
  initTitleBar({
    newFile: () => createNewFileAtRoot(),
    newFolder: () => createNewFolderAtRoot(),
    openFolder: () => els.btnOpenFolderMain.click(),
    useVirtual: () => els.btnVirtualFs.click(),
    save: () => AppState.activeFilePath && saveFile(AppState.activeFilePath),
    saveAll: () => saveAllFiles(),
    exportZip: () => exportProjectAsZip(),
    importZip: () => els.btnImportZip.click(),
    runEditorAction,
    showView: showSidebarView,
    toggleSidebar,
    toggleMinimap: () => { els.cfgMinimap.checked = !els.cfgMinimap.checked; els.cfgMinimap.dispatchEvent(new Event('change')); },
    toggleWordWrap: () => { els.cfgWordWrap.checked = !els.cfgWordWrap.checked; els.cfgWordWrap.dispatchEvent(new Event('change')); },
    changeTheme: () => AppState.editorInstance && AppState.editorInstance.getAction('app.view.toggleTheme').run(),
    commandPalette: () => openCommandPalette(),
    quickOpen: () => openQuickOpen(),
    showWelcome: () => showLanding(),
    openGithub: () => openGithubRepository(),
    toggleProblems: () => toggleProblemsPanel(),
    showAbout: () => showAbout(),
    openSettings: () => els.settingsOverlay.classList.add('open'),
    openKeyboardShortcuts: () => openKeyboardShortcuts(),
    openSettingsJson: () => openSettingsJson(),
  });
}

// Every app command is now a REAL Monaco action: it shows up in its
// native Command Palette (Ctrl+Q) instead of a custom-built one.
function registerAllCommands() {
  registerAppAction({ id: 'app.help.about', label: 'Help: About Zern', run: () => showAbout() });
  registerAppAction({ id: 'app.view.toggleProblems', label: 'View: Toggle Problems', keybinding: 'Ctrl+Shift+M', global: true, run: () => toggleProblemsPanel() });
  registerAppAction({ id: 'app.github.open', label: 'GitHub: Open Repository...', run: () => openGithubRepository() });
  registerAppAction({ id: 'app.github.branch', label: 'GitHub: Switch or Create Branch...', run: () => branchPicker() });
  registerAppAction({ id: 'app.github.pull', label: 'GitHub: Pull', run: () => doPull() });
  registerAppAction({ id: 'app.github.signout', label: 'GitHub: Sign Out', run: () => signOut() });
  registerAppAction({ id: 'app.file.save', label: 'File: Save', keybinding: 'Ctrl+S', global: true, run: () => AppState.activeFilePath && saveFile(AppState.activeFilePath) });
  registerAppAction({ id: 'app.file.saveAll', label: 'File: Save All', run: () => saveAllFiles() });
  registerAppAction({ id: 'app.file.newFile', label: 'File: New File (root)', run: () => createNewFileAtRoot() });
  registerAppAction({ id: 'app.file.newFolder', label: 'File: New Folder (root)', run: () => createNewFolderAtRoot() });
  registerAppAction({ id: 'app.folder.open', label: 'Folder: Open Folder...', run: () => els.btnOpenFolderMain.click() });
  registerAppAction({ id: 'app.folder.virtual', label: 'Folder: Use Virtual Filesystem', run: () => els.btnVirtualFs.click() });
  registerAppAction({ id: 'app.project.exportZip', label: 'Project: Export as ZIP', run: () => exportProjectAsZip() });
  registerAppAction({ id: 'app.project.importZip', label: 'Project: Import from ZIP', run: () => els.btnImportZip.click() });
  registerAppAction({ id: 'app.editor.find', label: 'Editor: Find', run: () => AppState.editorInstance && AppState.editorInstance.getAction('actions.find').run() });
  registerAppAction({ id: 'app.file.quickOpen', label: 'Go to File...', keybinding: 'Ctrl+P', global: true, run: () => openQuickOpen() });
  registerAppAction({ id: 'app.view.extensions', label: 'View: Show Extensions', keybinding: 'Ctrl+Shift+X', global: true, run: () => showSidebarView('extensions') });
  registerAppAction({ id: 'app.view.toggleSidebar', label: 'View: Toggle Sidebar', keybinding: 'Ctrl+B', global: true, run: () => toggleSidebar() });
  registerAppAction({ id: 'app.view.explorer', label: 'View: Show Explorer', keybinding: 'Ctrl+Shift+E', global: true, run: () => showSidebarView('explorer') });
  registerAppAction({ id: 'app.view.search', label: 'View: Show Search', keybinding: 'Ctrl+Shift+F', global: true, run: () => showSidebarView('search') });
  registerAppAction({ id: 'app.view.scm', label: 'View: Show Source Control', keybinding: 'Ctrl+Shift+G', global: true, run: () => showSidebarView('scm') });
  registerAppAction({ id: 'app.view.toggleMinimap', label: 'View: Toggle Minimap', run: () => { els.cfgMinimap.checked = !els.cfgMinimap.checked; els.cfgMinimap.dispatchEvent(new Event('change')); } });
  registerAppAction({ id: 'app.view.toggleWordWrap', label: 'View: Toggle Word Wrap', run: () => { els.cfgWordWrap.checked = !els.cfgWordWrap.checked; els.cfgWordWrap.dispatchEvent(new Event('change')); } });
  registerAppAction({ id: 'app.view.toggleTheme', label: 'Preferences: Change Theme', run: () => {
    const currentIndex = THEME_ORDER.indexOf(activeThemeKey);
    const nextTheme = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
    applyTheme(nextTheme);
    updateEditorConfig({ theme: nextTheme });
    showToast({ type: 'info', message: `Theme: ${THEMES[nextTheme].label}`, timeout: 1800 });
  } });
  registerAppAction({ id: 'app.help.welcome', label: 'Help: Show Welcome Page', run: () => showLanding() });
  registerAppAction({ id: 'app.preferences.open', label: 'Preferences: Open Settings', run: () => els.settingsOverlay.classList.add('open') });
  registerAppAction({ id: 'app.preferences.keyboard', label: 'Preferences: Open Keyboard Shortcuts', run: () => openKeyboardShortcuts() });
  registerAppAction({ id: 'app.preferences.json', label: 'Preferences: Open Settings (JSON)', run: () => openSettingsJson() });
}

// On phones the sidebar is a full-screen drawer (see mobile.css), so
// there's no room to see both the tree and the open file at once.
// Closing it automatically once a file is opened is what makes this
// actually usable one-handed - on desktop/tablet this media query
// never matches, so nothing changes there.
const MOBILE_BREAKPOINT = '(max-width: 600px)';
document.addEventListener('zern:file-opened', () => {
  if (!window.matchMedia(MOBILE_BREAKPOINT).matches) return;
  if (els.sideBar.classList.contains('collapsed')) return;

  els.sideBar.classList.add('collapsed');
  els.sidebarResizer.classList.add('collapsed');
  document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
  setTimeout(() => AppState.editorInstance && AppState.editorInstance.layout(), 240);
});

// "Reveal in Explorer" (tab context menu, duplicate) asks for the Explorer
// to be in front: it may be collapsed, or the Search view may be showing.
document.addEventListener('zern:show-explorer', () => {
  const explorerBtn = document.querySelector('.activity-btn[data-view="explorer"]');
  if (explorerBtn && (currentSidebarView !== 'explorer' || els.sideBar.classList.contains('collapsed'))) {
    explorerBtn.click();
  }
});

document.addEventListener('DOMContentLoaded', bootstrap);
window.addEventListener('error', (e) => console.error('Uncaught error:', e.error || e.message));

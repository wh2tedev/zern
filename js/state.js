// ============================================================
// state.js - Global application state
// ============================================================

export const AppState = {
  config: {
    fontSize: 14,
    wordWrap: 'off',
    autoSave: true,
    autoSaveDelay: 1500,
    theme: 'dark-2026',
    tabSize: 4,
    minimap: true,
    cursorStyle: 'line',
    lineHeight: 0, // 0 = automatic, based on font size
    formatOnSave: false,
    bracketPairColorization: true,
    autoCloseTags: true,
    semanticValidation: false,
    smoothScrolling: false,
    renderWhitespace: 'selection',
    uiFont: 'system',
    keybindings: {}, // custom shortcuts: { commandId: 'Ctrl+K' | null } (see keybindings.js)
  },

  openFiles: new Map(),
  activeFilePath: null,
  rootDirHandle: null,
  isRealFS: false,

  fileSystem: {
    name: 'root',
    type: 'folder',
    path: '/',
    expanded: true,
    children: [
      {
        name: 'index.html',
        type: 'file',
        path: '/index.html',
        content: '<!DOCTYPE html>\n<html>\n<head>\n  <title>New project</title>\n</head>\n<body>\n  <h1>Hello world</h1>\n</body>\n</html>\n'
      },
      {
        name: 'main.js',
        type: 'file',
        path: '/main.js',
        content: 'console.log("Hello from main.js");\n'
      }
    ]
  },

  // Active GitHub repository workspace (null = scratch virtual project / real folder)
  github: null,

  editorInstance: null,
  autoSaveTimer: null,
  virtualFsSaveTimer: null,
};

export function addOpenFile(path, fileData) {
  AppState.openFiles.set(path, {
    name: fileData.name,
    path,
    content: fileData.content ?? '',
    savedContent: fileData.content ?? '',
    model: fileData.model ?? null,
    viewState: fileData.viewState ?? null,
    language: fileData.language ?? 'plaintext',
    handle: fileData.handle ?? null,
    modified: fileData.modified ?? false,
    isVirtual: fileData.isVirtual ?? !AppState.isRealFS,
    isImage: fileData.isImage ?? false,
    imageUrl: fileData.imageUrl ?? null,
  });
}

export function getOpenFile(path) {
  return AppState.openFiles.get(path) || null;
}

export function removeOpenFile(path) {
  const file = AppState.openFiles.get(path);
  if (file && file.model) {
    file.model.dispose();
  }
  if (file && file.imageUrl) {
    URL.revokeObjectURL(file.imageUrl);
  }
  // Diff tabs own the baseline model (the working-tree side is the file's own model)
  if (file && file.baseModel) file.baseModel.dispose();
  if (file && file.emptyModel) file.emptyModel.dispose();
  AppState.openFiles.delete(path);

  if (AppState.activeFilePath === path) {
    const remaining = Array.from(AppState.openFiles.keys());
    AppState.activeFilePath = remaining.length
      ? remaining[remaining.length - 1]
      : null;
  }
}

export function setActiveFile(path) {
  if (AppState.openFiles.has(path)) {
    AppState.activeFilePath = path;
    return true;
  }
  return false;
}

export function markFileModified(path, modified = true) {
  const file = AppState.openFiles.get(path);
  if (file) {
    file.modified = modified;
  }
}

export function isAnyFileModified() {
  for (const file of AppState.openFiles.values()) {
    if (file.modified) return true;
  }
  return false;
}

export function reorderOpenFiles(orderedPaths) {
  const entries = orderedPaths
    .filter(p => AppState.openFiles.has(p))
    .map(p => [p, AppState.openFiles.get(p)]);
  AppState.openFiles = new Map(entries);
}

export function resetState() {
  AppState.openFiles.forEach(f => f.model && f.model.dispose());
  AppState.openFiles.clear();
  AppState.activeFilePath = null;
  AppState.rootDirHandle = null;
  AppState.isRealFS = false;
  clearTimeout(AppState.autoSaveTimer);
  AppState.autoSaveTimer = null;
}

export function loadConfig() {
  try {
    const saved = localStorage.getItem('editor_config');
    if (saved) {
      Object.assign(AppState.config, JSON.parse(saved));
    }
  } catch (e) {
    console.warn('Could not load saved configuration:', e);
  }
  return AppState.config;
}

export function saveConfig() {
  try {
    localStorage.setItem('editor_config', JSON.stringify(AppState.config));
  } catch (e) {
    console.warn('Could not save configuration:', e);
  }
  // Lets open views (e.g. the settings.json tab) stay in sync with changes made elsewhere
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('zern:config-changed'));
}

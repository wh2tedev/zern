// ============================================================
// editor.js - Monaco Editor, tabs, saving, shortcuts,
// IntelliSense, VS Code-style themes, and registration of
// real commands in Monaco's Command Palette
// ============================================================

import {
  AppState, addOpenFile, getOpenFile, removeOpenFile,
  setActiveFile, markFileModified, loadConfig, saveConfig, reorderOpenFiles,
} from './state.js';
import { getCachedHandle, updateExplorerModifiedIndicator } from './explorer.js';
import { verifyPermission, saveVirtualFileSystem } from './db.js';
import { getLanguageFromExtension } from './fs-utils.js';
import { setupIntelliSense } from './intellisense.js';
import { setupDeclarationScanner } from './declaration-scanner.js';
import { getFileIcon } from './icons.js';
import { showToast } from './notifications.js';
import { THEMES, resolveInitialTheme } from './themes.js';

// Monaco loads from a local copy first (fully offline), falling back
// to the CDN automatically if that local copy hasn't been downloaded.
// See assets/vendor/monaco-editor/README.md for how to add it.
const MONACO_LOCAL_PATH = 'assets/vendor/monaco-editor/min/vs';
const MONACO_CDN_PATH = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';
const VIRTUAL_FS_SAVE_DELAY = 800;

let tabsContainer = null;
let editorHostEl = null;
let imagePreviewHostEl = null;
let monacoNS = null;
let draggedTabPath = null;
let monacoBasePath = MONACO_CDN_PATH; // resolved once in loadMonacoLoader()

// Actions requested to be registered in Monaco while the editor
// instance doesn't exist yet (they get flushed once it's created).
const pendingActions = [];

async function resolveMonacoBasePath() {
  try {
    const res = await fetch(`${MONACO_LOCAL_PATH}/loader.js`, { method: 'HEAD' });
    if (res.ok) return MONACO_LOCAL_PATH;
  } catch {
    // no local copy present (or not served over http/https) - that's fine
  }
  return MONACO_CDN_PATH;
}

function loadMonacoLoader(basePath) {
  return new Promise((resolve, reject) => {
    if (window.require && window.require.config) { resolve(); return; }
    const script = document.createElement('script');
    script.src = `${basePath}/loader.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load the Monaco loader from ${basePath}.`));
    document.head.appendChild(script);
  });
}

// Re-inserts our Codicons <link> at the END of <head>, so its "codicon"
// @font-face cascades above the one bundled with Monaco. Called right
// after Monaco loads, and once more shortly after in case Monaco injects
// additional stylesheets lazily (when the find widget, suggestions,
// quick command, etc. mount for the first time).
function reprioritizeAppCodicons() {
  const link = document.getElementById('app-codicon-link');
  if (link) document.head.appendChild(link);
}

// ---------------- VS Code-accurate themes ----------------

// Builds a broad, consistent set of Monaco token rules from a compact
// color map. Monaco's built-in tokenizers ("Monarch") emit a fairly
// standard set of token class names across almost every language it
// ships with, so mapping ALL of them here (not just the handful of
// basics) meaningfully improves highlighting richness for every
// language at once, for every theme.
function buildTokenRules(c) {
  return [
    { token: 'comment', foreground: c.comment, fontStyle: 'italic' },
    { token: 'comment.doc', foreground: c.comment, fontStyle: 'italic' },
    { token: 'string', foreground: c.string },
    { token: 'string.escape', foreground: c.constant },
    { token: 'string.invalid', foreground: c.invalid },
    { token: 'string.regexp', foreground: c.regexp },
    { token: 'regexp', foreground: c.regexp },
    { token: 'number', foreground: c.number },
    { token: 'number.hex', foreground: c.number },
    { token: 'number.octal', foreground: c.number },
    { token: 'number.binary', foreground: c.number },
    { token: 'number.float', foreground: c.number },
    { token: 'keyword', foreground: c.keyword },
    { token: 'keyword.control', foreground: c.keyword },
    { token: 'keyword.flow', foreground: c.keyword },
    { token: 'keyword.json', foreground: c.keyword },
    { token: 'operator', foreground: c.operator },
    { token: 'operator.sql', foreground: c.operator },
    { token: 'delimiter', foreground: c.delimiter },
    { token: 'delimiter.bracket', foreground: c.delimiter },
    { token: 'delimiter.parenthesis', foreground: c.delimiter },
    { token: 'delimiter.square', foreground: c.delimiter },
    { token: 'delimiter.angle', foreground: c.delimiter },
    { token: 'delimiter.html', foreground: c.delimiter },
    { token: 'delimiter.xml', foreground: c.delimiter },
    { token: 'type', foreground: c.type },
    { token: 'type.identifier', foreground: c.type },
    { token: 'namespace', foreground: c.type },
    { token: 'identifier', foreground: c.variable },
    { token: 'function', foreground: c.function },
    { token: 'member', foreground: c.function },
    { token: 'variable', foreground: c.variable },
    { token: 'variable.name', foreground: c.variable },
    { token: 'variable.parameter', foreground: c.variableParam },
    { token: 'variable.predefined', foreground: c.constant },
    { token: 'constant', foreground: c.constant },
    { token: 'constant.language', foreground: c.constant },
    { token: 'constant.numeric', foreground: c.number },
    { token: 'annotation', foreground: c.annotation },
    { token: 'tag', foreground: c.tag },
    { token: 'metatag', foreground: c.tag },
    { token: 'attribute.name', foreground: c.attributeName },
    { token: 'attribute.value', foreground: c.attributeValue },
    { token: 'attribute.value.number', foreground: c.number },
    { token: 'key', foreground: c.attributeName },
    { token: 'predefined', foreground: c.constant },
    { token: 'invalid', foreground: c.invalid, fontStyle: 'underline' },
  ];
}

function defineVSCodeThemes(ns) {
  // Dark+ : the classic default
  ns.editor.defineTheme('vscode-dark-plus', {
    base: 'vs-dark',
    inherit: true,
    rules: buildTokenRules({
      comment: '6A9955', keyword: 'C586C0', string: 'CE9178', number: 'B5CEA8',
      type: '4EC9B0', function: 'DCDCAA', variable: '9CDCFE', variableParam: '9CDCFE',
      constant: '4FC1FF', tag: '569CD6', attributeName: '9CDCFE', attributeValue: 'CE9178',
      delimiter: 'D4D4D4', operator: 'D4D4D4', regexp: 'D16969', annotation: 'DCDCAA', invalid: 'F44747',
    }),
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#3a3d41',
      'editorCursor.foreground': '#aeafad',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editorIndentGuide.background': '#404040',
      'editorIndentGuide.activeBackground': '#707070',
      'editorWhitespace.foreground': '#404040',
      'editorGutter.background': '#1e1e1e',
      'editorWidget.background': '#252526',
      'editorWidget.border': '#454545',
      'editorSuggestWidget.background': '#252526',
      'editorSuggestWidget.border': '#454545',
      'editorSuggestWidget.selectedBackground': '#04395e',
      'input.background': '#3c3c3c',
      'input.border': '#3c3c3c',
      'list.hoverBackground': '#2a2d2e',
      'list.activeSelectionBackground': '#04395e',
      'scrollbarSlider.background': '#79797966',
      'scrollbarSlider.hoverBackground': '#646464b3',
    },
  });

  // Light+ : the classic light default
  ns.editor.defineTheme('vscode-light-plus', {
    base: 'vs',
    inherit: true,
    rules: buildTokenRules({
      comment: '008000', keyword: 'AF00DB', string: 'A31515', number: '098658',
      type: '267F99', function: '795E26', variable: '001080', variableParam: '001080',
      constant: '0070C1', tag: '800000', attributeName: 'FF0000', attributeValue: '0000FF',
      delimiter: '000000', operator: '000000', regexp: '811F3F', annotation: '795E26', invalid: 'CD3131',
    }),
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#000000',
      'editorLineNumber.foreground': '#237893',
      'editor.lineHighlightBackground': '#f3f3f3',
      'editor.selectionBackground': '#add6ff',
    },
  });

  // Dark Modern: VS Code's default right before Dark 2026. Same syntax
  // palette as Dark+, with the slightly darker, more neutral background
  // (#1f1f1f) the "Modern" redesign brought.
  ns.editor.defineTheme('vscode-dark-modern', {
    base: 'vs-dark',
    inherit: true,
    rules: buildTokenRules({
      comment: '6A9955', keyword: 'C586C0', string: 'CE9178', number: 'B5CEA8',
      type: '4EC9B0', function: 'DCDCAA', variable: '9CDCFE', variableParam: '9CDCFE',
      constant: '4FC1FF', tag: '569CD6', attributeName: '9CDCFE', attributeValue: 'CE9178',
      delimiter: 'D4D4D4', operator: 'D4D4D4', regexp: 'D16969', annotation: 'DCDCAA', invalid: 'F44747',
    }),
    colors: {
      'editor.background': '#1f1f1f',
      'editor.foreground': '#cccccc',
      'editorLineNumber.foreground': '#6e7681',
      'editorLineNumber.activeForeground': '#cccccc',
      'editor.selectionBackground': '#264f78',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editorIndentGuide.background': '#2b2b2b',
      'editorIndentGuide.activeBackground': '#525252',
      'editorGutter.background': '#1f1f1f',
      'editorWidget.background': '#202020',
      'list.hoverBackground': '#2a2d2e',
      'list.activeSelectionBackground': '#04395e',
    },
  });

  // Light Modern: light counterpart of the above.
  ns.editor.defineTheme('vscode-light-modern', {
    base: 'vs',
    inherit: true,
    rules: buildTokenRules({
      comment: '008000', keyword: 'AF00DB', string: 'A31515', number: '098658',
      type: '267F99', function: '795E26', variable: '001080', variableParam: '001080',
      constant: '0070C1', tag: '800000', attributeName: 'FF0000', attributeValue: '0000FF',
      delimiter: '000000', operator: '000000', regexp: '811F3F', annotation: '795E26', invalid: 'CD3131',
    }),
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#3b3b3b',
      'editorLineNumber.foreground': '#237893',
      'editor.lineHighlightBackground': '#f2f2f2',
      'editor.selectionBackground': '#add6ff',
    },
  });

  // Dark 2026: the new official default since VS Code 1.113 (March 2026).
  // Colors taken from Microsoft's published spec: editor background
  // #121314, sidebar #191A1B, strings in light blue #a5d6ff, parameters
  // in orange #ffa657, functions in purple #d2a8ff, structural keywords
  // in red #ff7b72, tags/JSX in green #7ee787.
  ns.editor.defineTheme('vscode-dark-2026', {
    base: 'vs-dark',
    inherit: true,
    rules: buildTokenRules({
      comment: '84A980', keyword: 'C586C0', string: 'A5D6FF', number: 'B5CEA8',
      type: '4EC9B0', function: 'D2A8FF', variable: 'E6E6E6', variableParam: 'FFA657',
      constant: 'FFA657', tag: '7EE787', attributeName: '9CDCFE', attributeValue: 'A5D6FF',
      delimiter: 'D4D4D4', operator: 'D4D4D4', regexp: 'A5D6FF', annotation: 'D2A8FF', invalid: 'FF7B72',
    }),
    colors: {
      'editor.background': '#121314',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#6e7681',
      'editorLineNumber.activeForeground': '#d4d4d4',
      'editor.selectionBackground': '#284a59',
      'editor.inactiveSelectionBackground': '#2a2d2e',
      'editorCursor.foreground': '#d4d4d4',
      'editor.lineHighlightBackground': '#191a1b',
      'editorIndentGuide.background': '#2b2c2d',
      'editorIndentGuide.activeBackground': '#4a4a4a',
      'editorWhitespace.foreground': '#2b2c2d',
      'editorGutter.background': '#121314',
      'editorWidget.background': '#191a1b',
      'editorWidget.border': '#2b2c2d',
      'editorSuggestWidget.background': '#191a1b',
      'editorSuggestWidget.border': '#2b2c2d',
      'editorSuggestWidget.selectedBackground': '#284a59',
      'input.background': '#191a1b',
      'input.border': '#2b2c2d',
      'list.hoverBackground': '#1d3e4b',
      'list.activeSelectionBackground': '#284a59',
      'editor.findMatchBackground': '#284a59',
      'editor.findMatchHighlightBackground': '#1d3e4b',
      'scrollbarSlider.background': '#79797966',
      'scrollbarSlider.hoverBackground': '#646464b3',
    },
  });

  // Monokai: classic theme included as an extra option for variety.
  ns.editor.defineTheme('monokai', {
    base: 'vs-dark',
    inherit: true,
    rules: buildTokenRules({
      comment: '75715E', keyword: 'F92672', string: 'E6DB74', number: 'AE81FF',
      type: '66D9EF', function: 'A6E22E', variable: 'F8F8F2', variableParam: 'FD971F',
      constant: 'AE81FF', tag: 'F92672', attributeName: 'A6E22E', attributeValue: 'E6DB74',
      delimiter: 'F8F8F2', operator: 'F92672', regexp: 'E6DB74', annotation: 'A6E22E', invalid: 'F44747',
    }),
    colors: {
      'editor.background': '#272822',
      'editor.foreground': '#f8f8f2',
      'editorLineNumber.foreground': '#75715e',
      'editor.selectionBackground': '#49483e',
      'editor.lineHighlightBackground': '#3e3d32',
      'list.hoverBackground': '#3e3d32',
      'list.activeSelectionBackground': '#49483e',
    },
  });

  // Purple (Soft): a gentle violet/lavender theme, original to this
  // editor - not a port of any official VS Code theme.
  ns.editor.defineTheme('vscode-purple', {
    base: 'vs-dark',
    inherit: true,
    rules: buildTokenRules({
      comment: '8B7FA8', keyword: 'C4A7FF', string: 'F0ABFC', number: 'C4B5FD',
      type: '7DD3C0', function: 'D8B4FE', variable: 'E0D6F0', variableParam: 'FBBF6D',
      constant: 'FBBF6D', tag: 'C4A7FF', attributeName: 'A78BFA', attributeValue: 'F0ABFC',
      delimiter: 'A89BC4', operator: 'A89BC4', regexp: 'F0ABFC', annotation: 'D8B4FE', invalid: 'F87171',
    }),
    colors: {
      'editor.background': '#1e1729',
      'editor.foreground': '#e0d6f0',
      'editorLineNumber.foreground': '#6b5f85',
      'editorLineNumber.activeForeground': '#c4b5fd',
      'editor.selectionBackground': '#3d3151',
      'editor.inactiveSelectionBackground': '#2c2438',
      'editorCursor.foreground': '#c4b5fd',
      'editor.lineHighlightBackground': '#251d33',
      'editorIndentGuide.background': '#332b44',
      'editorIndentGuide.activeBackground': '#5a4a75',
      'editorWhitespace.foreground': '#332b44',
      'editorGutter.background': '#1e1729',
      'editorWidget.background': '#241c33',
      'editorWidget.border': '#3d3151',
      'editorSuggestWidget.background': '#241c33',
      'editorSuggestWidget.border': '#3d3151',
      'editorSuggestWidget.selectedBackground': '#3d3151',
      'input.background': '#241c33',
      'input.border': '#3d3151',
      'list.hoverBackground': '#2c2438',
      'list.activeSelectionBackground': '#3d3151',
      'scrollbarSlider.background': '#4a3f6166',
      'scrollbarSlider.hoverBackground': '#5a4a75b3',
    },
  });
}

export async function initEditor({ editorHost, tabsHost, imagePreviewHost }) {
  editorHostEl = editorHost;
  tabsContainer = tabsHost;
  imagePreviewHostEl = imagePreviewHost;

  loadConfig();
  monacoBasePath = await resolveMonacoBasePath();
  await loadMonacoLoader(monacoBasePath);

  await new Promise((resolve, reject) => {
    window.require.config({ paths: { vs: monacoBasePath } });
    window.require(['vs/editor/editor.main'], () => { monacoNS = window.monaco; resolve(); }, reject);
  });

  reprioritizeAppCodicons();

  defineVSCodeThemes(monacoNS);
  setupIntelliSense(monacoNS);
  setupDeclarationScanner(monacoNS);

  const cfg = AppState.config;
  AppState.editorInstance = monacoNS.editor.create(editorHostEl, {
    value: '',
    language: 'plaintext',
    theme: THEMES[resolveInitialTheme(cfg)].monaco,
    fontSize: cfg.fontSize,
    wordWrap: cfg.wordWrap,
    tabSize: cfg.tabSize,
    minimap: { enabled: cfg.minimap },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    cursorBlinking: 'smooth',
    cursorStyle: cfg.cursorStyle || 'line',
    lineHeight: cfg.lineHeight || 0,
    renderLineHighlight: 'all',
    renderWhitespace: cfg.renderWhitespace || 'selection',
    bracketPairColorization: { enabled: cfg.bracketPairColorization !== false },
    smoothScrolling: !!cfg.smoothScrolling,
    guides: { indentation: true, bracketPairs: cfg.bracketPairColorization !== false },
    // IntelliSense / autocomplete comfort: suggests function and variable
    // names already used in the file as you type (word-based for most
    // languages; real semantic completion for JS/TS via the built-in
    // TypeScript language service).
    quickSuggestions: { other: true, comments: false, strings: false },
    quickSuggestionsDelay: 50,
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions: 'matchingDocuments',
    parameterHints: { enabled: true },
    tabCompletion: 'on',
    suggestSelection: 'recentlyUsedByPrefix',
    acceptSuggestionOnEnter: 'smart',
    snippetSuggestions: 'inline',
    suggest: {
      // Ranks identifiers that appear closer to the cursor higher in
      // the list - this is what keeps "already-typed word" suggestions
      // from getting buried under snippets/keywords further down.
      localityBonus: true,
      snippetsPreventQuickSuggestions: false,
      showWords: true,
    },
  });

  pendingActions.splice(0).forEach(addActionToEditor);

  setTimeout(reprioritizeAppCodicons, 500);
  setTimeout(reprioritizeAppCodicons, 2000);

  setupContentChangeTracking();
  setupKeyboardShortcuts();
  setupTabDragAndDrop();
  renderTabs();
  showEmptyState();

  return AppState.editorInstance;
}

// ---------------- Registering real commands in the Command Palette ----------------

// Converts a combo like "Ctrl+S" or "Ctrl+Shift+F" into a real Monaco
// keybinding (KeyMod.CtrlCmd maps to Ctrl on Win/Linux and Cmd on Mac).
function buildKeybinding(ns, combo) {
  if (!combo) return null;
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  let mod = 0;
  let keyCode = null;

  for (const part of parts) {
    if (part === 'ctrl' || part === 'cmd') mod |= ns.KeyMod.CtrlCmd;
    else if (part === 'shift') mod |= ns.KeyMod.Shift;
    else if (part === 'alt') mod |= ns.KeyMod.Alt;
    else keyCode = ns.KeyCode[`Key${part.toUpperCase()}`] ?? null;
  }

  return keyCode != null ? (mod | keyCode) : null;
}

function addActionToEditor({ id, label, keybinding, run }) {
  const keybindings = [];
  const built = buildKeybinding(monacoNS, keybinding);
  if (built != null) keybindings.push(built);

  AppState.editorInstance.addAction({
    id,
    label,
    keybindings,
    run: () => run(),
  });
}

/**
 * Registers an app command as a REAL Monaco action, visible and
 * runnable from its native Command Palette (Ctrl+Q).
 * @param {{id: string, label: string, keybinding?: string, run: () => void}} config
 */
export function registerAppAction(config) {
  if (AppState.editorInstance && monacoNS) {
    addActionToEditor(config);
  } else {
    pendingActions.push(config);
  }
}

/** Opens Monaco's native Command Palette (used by the Ctrl+Q shortcut). */
export function openCommandPalette() {
  if (!AppState.editorInstance) return;
  AppState.editorInstance.focus();
  const action = AppState.editorInstance.getAction('editor.action.quickCommand');
  if (action) action.run();
}

// ---------------- Virtual filesystem autosave ----------------

/**
 * Schedules a debounced save of the entire virtual file tree to
 * IndexedDB. Safe to call on every keystroke - it coalesces bursts
 * of changes into a single write.
 */
export function scheduleVirtualFsSave() {
  if (AppState.isRealFS) return;
  clearTimeout(AppState.virtualFsSaveTimer);
  AppState.virtualFsSaveTimer = setTimeout(() => {
    saveVirtualFileSystem(AppState.fileSystem).catch((err) => {
      console.warn('Could not persist the virtual project:', err);
    });
  }, VIRTUAL_FS_SAVE_DELAY);
}

// ---------------- Tabs ----------------

export function openFileInEditor(fileInfo) {
  const { path, name, content, language, handle, isVirtual, lastModified, isImage, imageUrl } = fileInfo;
  let file = getOpenFile(path);

  if (!file) {
    if (isImage) {
      addOpenFile(path, { name, handle, isVirtual, isImage: true, imageUrl, modified: false });
    } else {
      const uri = monacoNS.Uri.file(path);
      // Safety net: if a stale model somehow still holds this exact URI
      // (e.g. it wasn't disposed properly by some earlier code path),
      // get rid of it first - Monaco throws if you try to create two
      // models with the same URI.
      const existingModel = monacoNS.editor.getModel(uri);
      if (existingModel) existingModel.dispose();

      const model = monacoNS.editor.createModel(content, language, uri);
      model.onDidChangeContent(() => handleModelChange(path));
      addOpenFile(path, { name, content, model, language, handle, isVirtual, modified: false });
    }
    file = getOpenFile(path);
    file.lastKnownModified = lastModified ?? null;
  }

  activateTab(path);
}

function handleModelChange(path) {
  const file = getOpenFile(path);
  if (!file) return;

  const currentValue = file.model.getValue();
  const isDirty = currentValue !== file.savedContent;

  if (file.modified !== isDirty) {
    markFileModified(path, isDirty);
    updateTabModifiedIndicator(path, isDirty);
    updateExplorerModifiedIndicator(path, isDirty);
  }

  if (isDirty && AppState.config.autoSave) {
    clearTimeout(AppState.autoSaveTimer);
    AppState.autoSaveTimer = setTimeout(() => saveFile(AppState.activeFilePath), AppState.config.autoSaveDelay);
  }
}

function renderTabs() {
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';
  for (const [path, file] of AppState.openFiles.entries()) {
    tabsContainer.appendChild(buildTabElement(path, file));
  }
}

function buildTabElement(path, file) {
  const tab = document.createElement('div');
  tab.className = 'editor-tab';
  tab.dataset.path = path;
  tab.draggable = true;
  if (path === AppState.activeFilePath) tab.classList.add('active');

  const iconEl = document.createElement('span');
  iconEl.className = 'tab-icon';
  iconEl.innerHTML = getFileIcon(file.name);
  tab.appendChild(iconEl);

  const label = document.createElement('span');
  label.className = 'tab-label';
  label.textContent = (file.modified ? '\u25CF ' : '') + file.name;
  tab.appendChild(label);

  const closeBtn = document.createElement('span');
  closeBtn.className = 'tab-close';
  closeBtn.innerHTML = '<i class="codicon codicon-close"></i>';
  closeBtn.title = 'Close';
  tab.appendChild(closeBtn);

  tab.addEventListener('click', (e) => { if (e.target !== closeBtn && !closeBtn.contains(e.target)) activateTab(path); });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTab(path); });

  tab.addEventListener('dragstart', (e) => {
    draggedTabPath = path;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', path); } catch { /* ignore */ }
    tab.classList.add('dragging');
  });
  tab.addEventListener('dragend', () => {
    tab.classList.remove('dragging');
    draggedTabPath = null;
    clearTabDropIndicators();
  });

  return tab;
}

function clearTabDropIndicators() {
  if (!tabsContainer) return;
  tabsContainer.querySelectorAll('.editor-tab.drop-before, .editor-tab.drop-after')
    .forEach(t => t.classList.remove('drop-before', 'drop-after'));
}

// Reordering tabs by dragging: listeners are bound ONCE on the
// container (event delegation) since renderTabs() wipes and rebuilds
// individual tab elements on every render.
function setupTabDragAndDrop() {
  if (!tabsContainer) return;

  tabsContainer.addEventListener('dragover', (e) => {
    if (!draggedTabPath) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetTab = e.target.closest('.editor-tab');
    clearTabDropIndicators();
    if (!targetTab || targetTab.dataset.path === draggedTabPath) return;

    const rect = targetTab.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    targetTab.classList.add(before ? 'drop-before' : 'drop-after');
  });

  tabsContainer.addEventListener('drop', (e) => {
    if (!draggedTabPath) return;
    e.preventDefault();

    const targetTab = e.target.closest('.editor-tab');
    clearTabDropIndicators();
    if (!targetTab || targetTab.dataset.path === draggedTabPath) return;

    const rect = targetTab.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    const targetPath = targetTab.dataset.path;

    const order = Array.from(AppState.openFiles.keys());
    const fromIdx = order.indexOf(draggedTabPath);
    if (fromIdx === -1) return;
    order.splice(fromIdx, 1);

    let toIdx = order.indexOf(targetPath);
    if (toIdx === -1) return;
    if (!before) toIdx += 1;
    order.splice(toIdx, 0, draggedTabPath);

    reorderOpenFiles(order);
    renderTabs();
  });
}

function activateTab(path) {
  const file = getOpenFile(path);
  if (!file) return;

  if (AppState.activeFilePath) {
    const prevFile = getOpenFile(AppState.activeFilePath);
    if (prevFile && !prevFile.isImage) prevFile.viewState = AppState.editorInstance.saveViewState();
  }

  setActiveFile(path);

  if (file.isImage) {
    showImagePreview(file);
  } else {
    hideImagePreview();
    AppState.editorInstance.setModel(file.model);
    if (file.viewState) AppState.editorInstance.restoreViewState(file.viewState);
    AppState.editorInstance.focus();
  }

  hideEmptyState();
  renderTabs();
}

let currentZoomImageEl = null;
let currentZoomLevel = 1;

function showImagePreview(file) {
  if (editorHostEl) editorHostEl.style.display = 'none';
  if (!imagePreviewHostEl) return;

  imagePreviewHostEl.innerHTML = '';
  imagePreviewHostEl.classList.add('visible');

  const inner = document.createElement('div');
  inner.className = 'image-preview-inner';

  const img = document.createElement('img');
  img.className = 'image-preview-img';
  img.src = file.imageUrl;
  img.alt = file.name;
  inner.appendChild(img);

  const toolbar = document.createElement('div');
  toolbar.className = 'image-preview-toolbar';
  toolbar.innerHTML = `
    <button type="button" class="image-zoom-btn" data-zoom="out" title="Zoom out"><i class="codicon codicon-dash"></i></button>
    <span class="image-zoom-level">100%</span>
    <button type="button" class="image-zoom-btn" data-zoom="in" title="Zoom in"><i class="codicon codicon-add"></i></button>
    <button type="button" class="image-zoom-btn" data-zoom="reset" title="Fit to window"><i class="codicon codicon-screen-full"></i></button>
  `;
  toolbar.querySelectorAll('.image-zoom-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.zoom;
      if (action === 'in') setImageZoom(currentZoomLevel * 1.25);
      else if (action === 'out') setImageZoom(currentZoomLevel / 1.25);
      else fitImageToContainer(img);
    });
  });

  imagePreviewHostEl.appendChild(inner);
  imagePreviewHostEl.appendChild(toolbar);
  imagePreviewHostEl.addEventListener('wheel', onImageWheel, { passive: false });

  currentZoomImageEl = img;
  if (img.complete && img.naturalWidth) {
    fitImageToContainer(img);
  } else {
    img.addEventListener('load', () => fitImageToContainer(img), { once: true });
  }
}

function fitImageToContainer(img) {
  if (!imagePreviewHostEl) return;
  const availableWidth = imagePreviewHostEl.clientWidth - 64;
  const availableHeight = imagePreviewHostEl.clientHeight - 64;
  const naturalW = img.naturalWidth || availableWidth;
  const naturalH = img.naturalHeight || availableHeight;
  const fitScale = Math.min(1, availableWidth / naturalW, availableHeight / naturalH);
  setImageZoom(fitScale > 0 ? fitScale : 1);
}

function setImageZoom(zoom) {
  if (!currentZoomImageEl) return;
  currentZoomLevel = Math.min(8, Math.max(0.1, zoom));
  const naturalW = currentZoomImageEl.naturalWidth;
  if (naturalW) {
    currentZoomImageEl.style.width = `${Math.round(naturalW * currentZoomLevel)}px`;
  }
  const label = imagePreviewHostEl && imagePreviewHostEl.querySelector('.image-zoom-level');
  if (label) label.textContent = `${Math.round(currentZoomLevel * 100)}%`;
}

function onImageWheel(e) {
  if (!currentZoomImageEl) return;
  e.preventDefault();
  const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  setImageZoom(currentZoomLevel * delta);
}

function hideImagePreview() {
  if (editorHostEl) editorHostEl.style.display = '';
  if (imagePreviewHostEl) {
    imagePreviewHostEl.removeEventListener('wheel', onImageWheel);
    imagePreviewHostEl.classList.remove('visible');
    imagePreviewHostEl.innerHTML = '';
  }
  currentZoomImageEl = null;
  currentZoomLevel = 1;
}

function closeTab(path) {
  const file = getOpenFile(path);
  if (!file) return;

  if (file.modified) {
    const discard = confirm(`"${file.name}" has unsaved changes. Close anyway?`);
    if (!discard) return;
  }
  finalizeTabRemoval(path);
}

export function forceCloseTab(path) {
  if (!getOpenFile(path)) return;
  finalizeTabRemoval(path);
}

function finalizeTabRemoval(path) {
  removeOpenFile(path);
  if (AppState.activeFilePath) {
    activateTab(AppState.activeFilePath);
  } else {
    hideImagePreview();
    AppState.editorInstance.setModel(null);
    showEmptyState();
    renderTabs();
  }
}

export function renameOpenFile(oldPath, newPath, newName, newHandle) {
  const file = AppState.openFiles.get(oldPath);
  if (!file) return;

  AppState.openFiles.delete(oldPath);
  file.name = newName;
  file.path = newPath;
  if (newHandle) file.handle = newHandle;

  const newLang = getLanguageFromExtension(newName);
  if (newLang && file.model && monacoNS) {
    monacoNS.editor.setModelLanguage(file.model, newLang);
    file.language = newLang;
  }

  AppState.openFiles.set(newPath, file);
  if (AppState.activeFilePath === oldPath) AppState.activeFilePath = newPath;
  renderTabs();
}

export async function reloadFileFromDisk(path) {
  const file = getOpenFile(path);
  if (!file || !file.handle) return;
  try {
    const fsFile = await file.handle.getFile();
    const content = await fsFile.text();
    file.model.setValue(content);
    file.content = content;
    file.savedContent = content;
    file.lastKnownModified = fsFile.lastModified;
    markFileModified(path, false);
    updateTabModifiedIndicator(path, false);
    updateExplorerModifiedIndicator(path, false);
    showToast({ type: 'success', message: `"${file.name}" reloaded from disk` });
  } catch (err) {
    console.error('Error reloading file:', err);
    showToast({ type: 'error', message: `Could not reload "${file.name}": ${err.message}` });
  }
}

export function updateTabModifiedIndicator(path, modified) {
  if (!tabsContainer) return;
  const tabEl = tabsContainer.querySelector(`.editor-tab[data-path="${CSS.escape(path)}"] .tab-label`);
  const file = getOpenFile(path);
  if (tabEl && file) tabEl.textContent = (modified ? '\u25CF ' : '') + file.name;
}

function showEmptyState() { if (editorHostEl) editorHostEl.classList.add('editor-empty'); }
function hideEmptyState() { if (editorHostEl) editorHostEl.classList.remove('editor-empty'); }

export async function saveFile(path) {
  const file = getOpenFile(path);
  if (!file) return false;
  if (file.isImage) return false; // images have no editable model to save

  // Format on save only applies to the file currently shown in the
  // editor, since the format action operates on the live model.
  if (AppState.config.formatOnSave && AppState.editorInstance && AppState.activeFilePath === path) {
    try {
      const formatAction = AppState.editorInstance.getAction('editor.action.formatDocument');
      if (formatAction) await formatAction.run();
    } catch (err) {
      console.warn('Formatting failed, saving unformatted:', err);
    }
  }

  const content = file.model.getValue();
  file.content = content;

  try {
    if (!file.isVirtual) {
      let handle = file.handle || (getCachedHandle(path) || {}).handle;
      if (!handle) { console.warn('Could not find the real handle for', path); return false; }

      const granted = await verifyPermission(handle, true);
      if (!granted) {
        showToast({ type: 'error', message: `Write permission denied for "${file.name}".` });
        return false;
      }

      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();

      const fsFile = await handle.getFile();
      file.lastKnownModified = fsFile.lastModified;
    } else {
      const { findFileByPath } = await import('./fs-utils.js');
      const node = findFileByPath(AppState.fileSystem, path);
      if (node) node.content = content;
      scheduleVirtualFsSave();
    }

    file.savedContent = content;
    markFileModified(path, false);
    updateTabModifiedIndicator(path, false);
    updateExplorerModifiedIndicator(path, false);
    showToast({ type: 'success', message: `"${file.name}" saved`, timeout: 2200 });
    return true;
  } catch (err) {
    console.error('Error saving file:', err);
    showToast({ type: 'error', message: `Could not save "${file.name}": ${err.message}` });
    return false;
  }
}

export async function saveAllFiles() {
  for (const path of AppState.openFiles.keys()) await saveFile(path);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', async (e) => {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    if (ctrlOrCmd && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (AppState.activeFilePath) await saveFile(AppState.activeFilePath);
      return;
    }

    // Ctrl+Q opens Monaco's REAL Command Palette (editor.action.quickCommand),
    // with all of the app's commands registered as native actions.
    if (ctrlOrCmd && e.key.toLowerCase() === 'q') {
      e.preventDefault();
      openCommandPalette();
      return;
    }

    if (ctrlOrCmd && e.key.toLowerCase() === 'w') {
      if (AppState.activeFilePath) { e.preventDefault(); closeTab(AppState.activeFilePath); }
    }
  });
}

function setupContentChangeTracking() {
  window.addEventListener('beforeunload', (e) => {
    let anyModified = false;
    for (const file of AppState.openFiles.values()) { if (file.modified) { anyModified = true; break; } }
    if (anyModified) { e.preventDefault(); e.returnValue = ''; }
  });
}

export function updateEditorConfig(partialConfig) {
  Object.assign(AppState.config, partialConfig);
  saveConfig();
  if (!AppState.editorInstance) return;

  if ('fontSize' in partialConfig) AppState.editorInstance.updateOptions({ fontSize: partialConfig.fontSize });
  if ('wordWrap' in partialConfig) AppState.editorInstance.updateOptions({ wordWrap: partialConfig.wordWrap });
  if ('minimap' in partialConfig) AppState.editorInstance.updateOptions({ minimap: { enabled: partialConfig.minimap } });
  if ('cursorStyle' in partialConfig) AppState.editorInstance.updateOptions({ cursorStyle: partialConfig.cursorStyle });
  if ('lineHeight' in partialConfig) AppState.editorInstance.updateOptions({ lineHeight: partialConfig.lineHeight });
  if ('bracketPairColorization' in partialConfig) {
    AppState.editorInstance.updateOptions({
      bracketPairColorization: { enabled: partialConfig.bracketPairColorization },
      guides: { bracketPairs: partialConfig.bracketPairColorization },
    });
  }
  if ('smoothScrolling' in partialConfig) AppState.editorInstance.updateOptions({ smoothScrolling: partialConfig.smoothScrolling });
  if ('renderWhitespace' in partialConfig) AppState.editorInstance.updateOptions({ renderWhitespace: partialConfig.renderWhitespace });
  if ('darkTheme' in partialConfig) monacoNS.editor.setTheme(partialConfig.darkTheme ? 'vscode-dark-plus' : 'vscode-light-plus');
  if ('theme' in partialConfig && THEMES[partialConfig.theme]) monacoNS.editor.setTheme(THEMES[partialConfig.theme].monaco);
}

export function getActiveModel() {
  return AppState.activeFilePath ? getOpenFile(AppState.activeFilePath)?.model : null;
}

// ============================================================
// editor.js - Monaco Editor, tabs, saving, shortcuts,
// IntelliSense, VS Code-style themes, and registration of
// real commands in Monaco's Command Palette
// ============================================================

import { attachEditor as attachEditorHooks, runWillSave } from './extensions/editor-hooks.js';
import { pickItem } from './quick-pick.js';
import { defineCommand, undefineCommand, getKey, onChange as onKeybindingChange, toMonacoKeybinding, listCommands, runCommand } from './keybindings.js';
import {
  AppState, addOpenFile, getOpenFile, removeOpenFile,
  setActiveFile, markFileModified, loadConfig, saveConfig, reorderOpenFiles,
} from './state.js';
import { getCachedHandle, updateExplorerModifiedIndicator, revealInExplorer, copyEntryPath } from './explorer.js';
import { verifyPermission, saveVirtualFileSystem, saveWorkspace } from './db.js';
import { getLanguageFromExtension, normalizePath, findFileByPath } from './fs-utils.js';
import { ensureNodeContent } from './node-content.js';
import { setupIntelliSense } from './intellisense.js';
import { setupDeclarationScanner, setupDefinitionProvider } from './declaration-scanner.js';
import { getFileIcon, MENU_ICONS } from './icons.js';
import { showContextMenu } from './context-menu.js';
import { scheduleSessionSave } from './session.js';
import { getAutoCloseTag, AUTOCLOSE_MODES } from './html-autoclose.js';
import { reportSaveFailure } from './safety.js';
import { showToast } from './notifications.js';
import { THEMES, resolveInitialTheme } from './themes.js';

// Monaco loads from a local copy first (fully offline), falling back
// to the CDN automatically if that local copy hasn't been downloaded.
// See assets/vendor/monaco-editor/README.md for how to add it.
const MONACO_LOCAL_PATH = 'assets/vendor/monaco-editor/min/vs';
const MONACO_CDN_PATH = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs';
const VIRTUAL_FS_SAVE_DELAY = 800;

let tabsContainer = null;
let editorHostEl = null;
let imagePreviewHostEl = null;
let diffHostEl = null;
let diffEditor = null;
let monacoNS = null;
let draggedTabPath = null;
let monacoBasePath = MONACO_CDN_PATH; // resolved once in loadMonacoLoader()

// Actions requested to be registered in Monaco while the editor
// instance doesn't exist yet (they get flushed once it's created).
const pendingActions = [];
const liveActions = new Map(); // command id -> { config, disposable } (for re-binding shortcuts)

let monacoSource = 'cdn';
/** 'local' (bundled copy, works offline) or 'cdn' (online only): shown in Help > About. */
export const getMonacoSource = () => monacoSource;

async function resolveMonacoBasePath() {
  if (window.zernDesktop && location.protocol === 'file:') { monacoSource = 'local'; return MONACO_LOCAL_PATH; } // the desktop app ships Monaco; fetch() can't probe file:// reliably
  try {
    // A plain GET (not HEAD): the service worker answers GETs from its cache, so this also works offline,
    // and some hosts reject HEAD requests.
    const res = await fetch(`${MONACO_LOCAL_PATH}/loader.js`);
    if (res.ok) { monacoSource = 'local'; console.info('[Zern] Editor engine: local copy'); return MONACO_LOCAL_PATH; }
  } catch {
    // no local copy reachable (not served over http/https, or offline without a cached copy)
  }
  monacoSource = 'cdn';
  console.info('[Zern] Editor engine: local copy not found, using the CDN (needs internet). See assets/vendor/monaco-editor/README.md');
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
  // Nordic: arctic blue-grey palette inspired by the Nord colors
  // (polar night backgrounds, snow storm text, frost blues/teals for
  // keywords/types/functions, aurora accents for strings/numbers).
  // The extra rules after buildTokenRules() fine-tune tokens that the
  // shared color map would otherwise force to a single color.
  ns.editor.defineTheme('vscode-nordic', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      ...buildTokenRules({
        comment: '616E88', keyword: '81A1C1', string: 'A3BE8C', number: 'B48EAD',
        type: '8FBCBB', function: '88C0D0', variable: 'D8DEE9', variableParam: 'D8DEE9',
        constant: '81A1C1', tag: '81A1C1', attributeName: '8FBCBB', attributeValue: 'A3BE8C',
        delimiter: 'ECEFF4', operator: '81A1C1', regexp: 'EBCB8B', annotation: 'D08770', invalid: 'BF616A',
      }),
      { token: 'string.escape', foreground: 'EBCB8B' },
      { token: 'constant.numeric', foreground: 'B48EAD' },
    ],
    colors: {
      'editor.background': '#2e3440',
      'editor.foreground': '#d8dee9',
      'editorLineNumber.foreground': '#4c566a',
      'editorLineNumber.activeForeground': '#d8dee9',
      'editor.selectionBackground': '#434c5e',
      'editor.inactiveSelectionBackground': '#3b4252',
      'editor.selectionHighlightBackground': '#434c5e99',
      'editor.wordHighlightBackground': '#434c5e99',
      'editorCursor.foreground': '#d8dee9',
      'editor.lineHighlightBackground': '#3b4252',
      'editorIndentGuide.background': '#3b4252',
      'editorIndentGuide.activeBackground': '#4c566a',
      'editorWhitespace.foreground': '#434c5e',
      'editorGutter.background': '#2e3440',
      'editorBracketMatch.background': '#88c0d033',
      'editorBracketMatch.border': '#88c0d0',
      'editorBracketHighlight.foreground1': '#81a1c1',
      'editorBracketHighlight.foreground2': '#8fbcbb',
      'editorBracketHighlight.foreground3': '#ebcb8b',
      'editorBracketHighlight.foreground4': '#b48ead',
      'editorBracketHighlight.foreground5': '#a3be8c',
      'editorBracketHighlight.foreground6': '#d08770',
      'editorBracketHighlight.unexpectedBracket.foreground': '#bf616a',
      'editorWidget.background': '#272c36',
      'editorWidget.border': '#3b4252',
      'editorSuggestWidget.background': '#272c36',
      'editorSuggestWidget.border': '#3b4252',
      'editorSuggestWidget.selectedBackground': '#434c5e',
      'editorSuggestWidget.highlightForeground': '#88c0d0',
      'input.background': '#3b4252',
      'input.border': '#4c566a',
      'list.hoverBackground': '#3b4252',
      'list.activeSelectionBackground': '#434c5e',
      'editor.findMatchBackground': '#5e81ac80',
      'editor.findMatchHighlightBackground': '#5e81ac40',
      'scrollbarSlider.background': '#4c566a66',
      'scrollbarSlider.hoverBackground': '#5a657fb3',
    },
  });
}

export async function initEditor({ editorHost, tabsHost, imagePreviewHost }) {
  editorHostEl = editorHost;
  tabsContainer = tabsHost;
  imagePreviewHostEl = imagePreviewHost;
  diffHostEl = document.getElementById('diff-host');

  loadConfig();
  monacoBasePath = await resolveMonacoBasePath();
  await loadMonacoLoader(monacoBasePath);

  await new Promise((resolve, reject) => {
    window.require.config({ paths: { vs: monacoBasePath } });
    window.require(['vs/editor/editor.main'], () => { monacoNS = window.monaco; resolve(); }, reject);
  });


  defineVSCodeThemes(monacoNS);
  setupIntelliSense(monacoNS, { semanticValidation: AppState.config.semanticValidation === true });
  setupDeclarationScanner(monacoNS);
  setupDefinitionProvider(monacoNS);

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

  pendingActions.splice(0).forEach((entry) => { if (!entry.disposed) mountAction(entry); });
  attachEditorHooks(AppState.editorInstance); // extension hooks (scroll events)

  registerDefinitionOpener();
  setupHtmlAutoClose(AppState.editorInstance);

  // Keep the saved session (tabs + cursor/scroll) fresh. Both calls are
  // debounced inside session.js, so this is cheap while typing/scrolling.
  AppState.editorInstance.onDidChangeCursorPosition(() => scheduleSessionSave());
  AppState.editorInstance.onDidScrollChange(() => scheduleSessionSave());


  setupContentChangeTracking();
  setupKeyboardShortcuts();
  setupTabDragAndDrop();
  renderTabs();
  showEmptyState();

  return AppState.editorInstance;
}

// ---------------- HTML auto-close tags ----------------

// Typing ">" at the end of an opening tag inserts the matching closing tag and
// leaves the cursor between them. The decision (void elements, comments, quotes,
// <script>/<style>, PHP blocks...) lives in html-autoclose.js; this is only the glue.
// onDidType fires for real keystrokes only (never for paste, undo or programmatic
// edits), after the character is already in the model.
function setupHtmlAutoClose(editor) {
  editor.onDidType((typed) => {
    if (typed !== '>' || AppState.config.autoCloseTags === false) return;
    autoCloseHtmlTags(editor);
  });
}

function autoCloseHtmlTags(editor) {
  const model = editor.getModel();
  if (!model) return;
  const mode = AUTOCLOSE_MODES[model.getLanguageId()];
  if (!mode) return;

  const selections = editor.getSelections();
  if (!selections || !selections.length || !selections.every((s) => s.isEmpty())) return;

  const text = model.getValue();
  const carets = selections.map((s) => s.getPosition())
    .sort((a, b) => a.lineNumber - b.lineNumber || a.column - b.column);

  // Multi-cursor: every insertion pushes the carets that follow it on the same line to the right.
  const shiftByLine = new Map();
  const edits = [];
  const finalCarets = [];

  for (const pos of carets) {
    const shift = shiftByLine.get(pos.lineNumber) || 0;
    const gt = model.getOffsetAt(pos) - 1; // index of the ">" just typed
    const closing = gt >= 0 && text[gt] === '>' ? getAutoCloseTag(text, gt, mode) : null;
    if (closing) {
      edits.push({
        range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column },
        text: closing,
        forceMoveMarkers: false,
      });
      shiftByLine.set(pos.lineNumber, shift + closing.length);
    }
    // The caret stays right after the ">" (i.e. before the inserted closing tag)
    finalCarets.push(new monacoNS.Selection(pos.lineNumber, pos.column + shift, pos.lineNumber, pos.column + shift));
  }

  if (edits.length) editor.executeEdits('html-autoclose', edits, finalCarets);
}

// ---------------- Go to Definition: jumping between open files ----------------

// When F12 / Ctrl+click lands in ANOTHER open file, Monaco's default
// behaviour is to just swap the model inside the editor - which would
// leave our tab bar pointing at the wrong file. This opener takes over
// for that case so the right tab becomes active; for a definition in the
// same file it steps aside and lets Monaco do its normal reveal.
function registerDefinitionOpener() {
  if (!monacoNS || typeof monacoNS.editor.registerEditorOpener !== 'function') return;

  monacoNS.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      if (source !== AppState.editorInstance) return false; // e.g. the peek widget's embedded editor

      const path = normalizePath(resource.path);
      const target = getOpenFile(path);
      if (!target || target.isImage || !target.model) return false;
      if (source.getModel() === target.model) return false;

      activateTab(path);

      const editor = AppState.editorInstance;
      if (selectionOrPosition && 'startLineNumber' in selectionOrPosition) {
        editor.setSelection(selectionOrPosition);
        editor.revealRangeInCenter(selectionOrPosition);
      } else if (selectionOrPosition) {
        editor.setPosition(selectionOrPosition);
        editor.revealPositionInCenter(selectionOrPosition);
      }
      return true;
    },
  });
}

// ---------------- Registering real commands in the Command Palette ----------------

// Converts a combo like "Ctrl+S" or "Ctrl+Shift+F" into a real Monaco
// keybinding (KeyMod.CtrlCmd maps to Ctrl on Win/Linux and Cmd on Mac).
const buildKeybinding = toMonacoKeybinding;

function addActionToEditor({ id, label, keybinding, run, contextMenu }) {
  const keybindings = [];
  const built = buildKeybinding(monacoNS, keybinding);
  if (built != null) keybindings.push(built);

  const options = { id, label, keybindings, run: () => run() };
  if (contextMenu) { // shown in the editor's right-click menu (extensions: contributes.menus["editor/context"])
    options.contextMenuGroupId = contextMenu.group || '9_zern';
    options.contextMenuOrder = contextMenu.order != null ? contextMenu.order : 1;
    if (contextMenu.when) options.precondition = contextMenu.when;
  }
  return AppState.editorInstance.addAction(options);
}

/**
 * Registers an app command as a REAL Monaco action, visible and
 * runnable from its native Command Palette (Ctrl+Q), and in the shared
 * keybinding registry so its shortcut can be customized.
 * @param {{id: string, label: string, keybinding?: string, run: () => void, global?: boolean, when?: () => boolean}} config
 *   global: also run the shortcut when the editor does not have focus.
 * @returns {{dispose: () => void}}
 */
export function registerAppAction(config) {
  defineCommand(config.id, { label: config.label, key: config.keybinding || null, run: config.run, global: !!config.global, when: config.when || null });
  const entry = { config, disposable: null, disposed: false };
  liveActions.set(config.id, entry);
  if (AppState.editorInstance && monacoNS) mountAction(entry);
  else pendingActions.push(entry);
  return {
    dispose() {
      entry.disposed = true;
      if (entry.disposable) { entry.disposable.dispose(); entry.disposable = null; }
      if (liveActions.get(config.id) === entry) { liveActions.delete(config.id); undefineCommand(config.id); }
    },
  };
}

function mountAction(entry) {
  entry.disposable = addActionToEditor({ ...entry.config, keybinding: getKey(entry.config.id) });
}

// When a shortcut changes (shortcuts editor / settings.json), re-bind the Monaco action.
onKeybindingChange((id) => {
  const entries = id ? [liveActions.get(id)] : [...liveActions.values()];
  for (const entry of entries) {
    if (!entry || !entry.disposable) continue;
    entry.disposable.dispose();
    mountAction(entry);
  }
});

/** Opens Monaco's native Command Palette (used by the Ctrl+Q shortcut). */
export function openCommandPalette() {
  const ed = AppState.editorInstance;
  const hasDocument = !!(ed && AppState.activeFilePath && ed.getModel());
  if (hasDocument) {
    ed.focus();
    const action = ed.getAction('editor.action.quickCommand');
    if (action) { action.run(); return; }
  }
  openFallbackPalette(); // Monaco's palette needs an open document: with none, list Zern's own commands
}

async function openFallbackPalette() {
  const items = listCommands()
    .filter((c) => c.id !== 'app.commandPalette')
    .map((c) => ({ label: c.label, description: c.key || '', value: c.id }));
  const id = await pickItem({ placeholder: 'Type the name of a command', items });
  if (id) runCommand(id);
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
    // A GitHub repository keeps its own record (tree + commit info + uncommitted changes)
    // so the scratch virtual project is never overwritten by it.
    const save = AppState.github
      ? saveWorkspace(AppState.github.id, { tree: AppState.fileSystem, meta: AppState.github })
      : saveVirtualFileSystem(AppState.fileSystem);
    save.catch(reportSaveFailure);
  }, VIRTUAL_FS_SAVE_DELAY);
  // Source Control listens to this to refresh the list of changed files
  document.dispatchEvent(new CustomEvent('zern:workspace-changed'));
}

// ---------------- Tabs ----------------

/**
 * Opens a document that is not a file on disk (for example settings.json) as a regular editor tab.
 * `save(text)` validates/applies it and resolves to true on success; it is never written to the file system.
 * `refresh()` returns fresh text, used when the tab is shown again while it has no unsaved edits.
 */
export function openCustomDocument({ path, name, text, language, save, refresh }) {
  let file = getOpenFile(path);
  if (!file) {
    const uri = monacoNS.Uri.parse(path);
    const stale = monacoNS.editor.getModel(uri);
    if (stale) stale.dispose();
    const model = monacoNS.editor.createModel(text, language, uri);
    model.onDidChangeContent(() => handleModelChange(path));
    addOpenFile(path, { name, content: text, model, language, isVirtual: true, modified: false });
    file = getOpenFile(path);
    file.custom = { save, refresh };
  }
  activateTab(path);
}

async function saveCustomDocument(path, file) {
  const content = file.model.getValue();
  const ok = await file.custom.save(content);
  if (ok) {
    file.content = content;
    file.savedContent = content;
    markFileModified(path, false);
    updateTabModifiedIndicator(path, false);
  }
  return !!ok;
}

function refreshCustomDocument(file) {
  if (!file.custom || !file.custom.refresh || file.modified) return;
  const text = file.custom.refresh();
  if (typeof text === 'string' && text !== file.model.getValue()) {
    file.savedContent = text; file.content = text;
    file.model.setValue(text);
  }
}

export function openFileInEditor(fileInfo) {
  const { path, name, content, language, handle, isVirtual, lastModified, isImage, imageUrl, activate } = fileInfo;
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

  // `activate: false` lets the session restore open many tabs in a row
  // without flashing through each one (it activates the right one at the end).
  if (activate === false) return;
  activateTab(path);
}

function handleModelChange(path) {
  const file = getOpenFile(path);
  if (!file) return;
  document.dispatchEvent(new CustomEvent('zern:content-changed', { detail: { path } })); // extensions (e.g. live preview) listen to this

  const currentValue = file.model.getValue();
  const isDirty = currentValue !== file.savedContent;

  if (file.modified !== isDirty) {
    markFileModified(path, isDirty);
    updateTabModifiedIndicator(path, isDirty);
    updateExplorerModifiedIndicator(path, isDirty);
  }

  if (isDirty && AppState.config.autoSave && !file.custom) { // settings.json is applied on Ctrl+S only, never half-typed
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
  // Every tab change (open, close, switch, reorder, rename) ends here.
  scheduleSessionSave();
  renderBreadcrumbs();
  document.dispatchEvent(new CustomEvent('zern:tabs-changed'));
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
  label.textContent = file.isDiff ? `${file.name} ${file.diffSuffix || ''}`.trim() : file.name;
  tab.appendChild(label);
  tab.classList.toggle('modified', !!file.modified);

  const closeBtn = document.createElement('span');
  closeBtn.className = 'tab-close';
  closeBtn.innerHTML = '<i class="zi zi-close"></i><i class="zi zi-circle-filled tab-dirty-dot"></i>';
  closeBtn.title = 'Close';
  tab.appendChild(closeBtn);

  tab.addEventListener('click', (e) => { if (e.target !== closeBtn && !closeBtn.contains(e.target)) activateTab(path); });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTab(path); });
  tab.addEventListener('contextmenu', (e) => onTabContextMenu(e, path));

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

// ---------------- Breadcrumbs (path of the active file, like VS Code) ----------------

function renderBreadcrumbs() {
  const host = document.getElementById('breadcrumbs');
  if (!host) return;
  const file = AppState.activeFilePath ? getOpenFile(AppState.activeFilePath) : null;
  if (!file) { host.hidden = true; host.innerHTML = ''; return; }

  const shownPath = file.custom ? `/${file.name}` : (file.isDiff ? file.targetPath : AppState.activeFilePath);
  const parts = normalizePath(shownPath).split('/').filter(Boolean);
  host.innerHTML = '';
  let acc = '';
  parts.forEach((part, i) => {
    acc += `/${part}`;
    const last = i === parts.length - 1;
    if (i > 0) {
      const sep = document.createElement('i');
      sep.className = 'zi zi-chevron-right crumb-sep';
      host.appendChild(sep);
    }
    const crumb = document.createElement('span');
    crumb.className = 'crumb' + (last ? ' crumb-last' : '');
    if (last) {
      const icon = document.createElement('span');
      icon.className = 'crumb-icon';
      icon.innerHTML = getFileIcon(file.name);
      crumb.appendChild(icon);
    }
    crumb.appendChild(document.createTextNode(part));
    const target = acc;
    if (!file.custom) crumb.addEventListener('click', () => revealInExplorer(target));
    host.appendChild(crumb);
  });
  host.hidden = false;
  host.scrollLeft = host.scrollWidth;
}

// ---------------- Tab context menu ----------------

function onTabContextMenu(e, tabKey) {
  e.preventDefault();
  const tabFile = getOpenFile(tabKey);
  const path = tabFile && tabFile.isDiff ? tabFile.targetPath : tabKey; // diff tabs point at their file
  const closePath = tabKey;

  const order = Array.from(AppState.openFiles.keys());
  const index = order.indexOf(path);
  const others = order.filter((p) => p !== path);
  const toTheRight = order.slice(index + 1);
  const saved = order.filter((p) => !getOpenFile(p)?.modified);

  showContextMenu(e.clientX, e.clientY, [
    { label: 'Close', icon: MENU_ICONS.close, keybinding: 'Ctrl+W', action: () => closeTab(closePath) },
    { label: 'Close Others', icon: MENU_ICONS.close, disabled: !others.length, action: () => closeMany(others) },
    { label: 'Close to the Right', icon: MENU_ICONS.close, disabled: !toTheRight.length, action: () => closeMany(toTheRight) },
    { label: 'Close Saved', icon: MENU_ICONS.close, disabled: !saved.length, action: () => closeMany(saved) },
    { label: 'Close All', icon: MENU_ICONS.closeAll, action: () => closeMany(order) },
    { separator: true },
    { label: 'Copy Path', icon: MENU_ICONS.copy, action: () => copyEntryPath(path, false) },
    { label: 'Copy Relative Path', icon: MENU_ICONS.copy, action: () => copyEntryPath(path, true) },
    { separator: true },
    { label: 'Reveal in Explorer', icon: MENU_ICONS.reveal, action: () => revealInExplorer(path) },
  ]);
}

/**
 * Closes several tabs at once. Unsaved files trigger ONE confirmation
 * for the whole batch (not one prompt per tab), and the editor is only
 * re-pointed once at the end.
 */
function closeMany(paths) {
  const targets = paths.filter((p) => getOpenFile(p));
  if (!targets.length) return;

  const dirty = targets.filter((p) => getOpenFile(p).modified);
  if (dirty.length) {
    const message = dirty.length === 1
      ? `"${getOpenFile(dirty[0]).name}" has unsaved changes. Close anyway?`
      : `${dirty.length} files have unsaved changes. Close them anyway?`;
    if (!confirm(message)) return;
  }

  const activeWasClosed = targets.includes(AppState.activeFilePath);
  targets.forEach((p) => removeOpenFileWithDiffs(p));

  if (AppState.activeFilePath) {
    if (activeWasClosed) activateTab(AppState.activeFilePath);
    else renderTabs(); // the shown file didn't change, only the tab bar did
  } else {
    hideImagePreview();
    hideDiff();
    AppState.editorInstance.setModel(null);
    showEmptyState();
    renderTabs();
  }
}

export function activateOpenTab(path) { activateTab(path); }

function activateTab(path) {
  const file = getOpenFile(path);
  if (!file) return;

  if (AppState.activeFilePath) {
    const prevFile = getOpenFile(AppState.activeFilePath);
    if (prevFile && !prevFile.isImage && !prevFile.isDiff) {
      // Only trust the editor's state if it is really showing that file.
      // After closing a tab its model is disposed and saveViewState()
      // would return null, wiping the position we had stored.
      const editor = AppState.editorInstance;
      if (editor.getModel() === prevFile.model) {
        const viewState = editor.saveViewState();
        if (viewState) prevFile.viewState = viewState;
      }
    }
  }

  setActiveFile(path);

  if (file.isDiff) {
    showDiff(file);
  } else if (file.isImage) {
    hideDiff();
    showImagePreview(file);
  } else {
    hideImagePreview();
    hideDiff();
    refreshCustomDocument(file);
    AppState.editorInstance.setModel(file.model);
    if (file.viewState) AppState.editorInstance.restoreViewState(file.viewState);
    AppState.editorInstance.focus();
  }

  hideEmptyState();
  renderTabs();
}

// ---------------- Diff tabs (Source Control) ----------------
// A diff tab compares the baseline of a file (left, read-only) with the file's own
// model (right, editable: typing there is typing in the file, so autosave keeps working).

function getDiffEditor() {
  if (!diffEditor) {
    diffEditor = monacoNS.editor.createDiffEditor(diffHostEl, {
      automaticLayout: true,
      renderSideBySide: true,
      originalEditable: false,
      enableSplitViewResizing: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      renderOverviewRuler: true,
    });
  }
  return diffEditor;
}

function showDiff(file) {
  hideImagePreview();
  if (editorHostEl) editorHostEl.style.display = 'none';
  if (!diffHostEl) return;
  diffHostEl.classList.add('visible');

  const target = file.targetPath ? getOpenFile(file.targetPath) : null;
  const modified = file.status === 'D' ? file.emptyModel : (target && target.model);
  if (!modified) return;

  const de = getDiffEditor();
  de.updateOptions({ fontSize: AppState.config.fontSize, wordWrap: AppState.config.wordWrap, readOnly: file.status === 'D' });
  de.setModel({ original: file.baseModel, modified });
}

function hideDiff() {
  if (diffHostEl) diffHostEl.classList.remove('visible');
  if (diffEditor) diffEditor.setModel(null);
  if (editorHostEl && diffHostEl && !(imagePreviewHostEl && imagePreviewHostEl.classList.contains('visible'))) {
    editorHostEl.style.display = '';
  }
}

async function ensureRealTab(path) {
  if (getOpenFile(path)) return true;
  const node = findFileByPath(AppState.fileSystem, path);
  if (!node || !(await ensureNodeContent(node))) return false;
  openFileInEditor({
    path: node.path, name: node.name, content: node.content, language: getLanguageFromExtension(node.name),
    handle: null, isVirtual: true, activate: false,
  });
  return true;
}

/** Shows an already-open file and selects `marker`'s range (used by the Problems panel). */
export function goToProblem(path, marker) {
  if (!getOpenFile(path)) return;
  activateTab(path);
  const ed = AppState.editorInstance;
  const range = {
    startLineNumber: marker.startLineNumber, startColumn: marker.startColumn,
    endLineNumber: marker.endLineNumber || marker.startLineNumber, endColumn: marker.endColumn || marker.startColumn,
  };
  ed.setSelection(range);
  ed.revealRangeInCenter(range);
  ed.focus();
}

/** Opens a workspace file in a normal tab and shows it (downloading it first if needed). */
export async function openWorkspaceFile(path) {
  if (await ensureRealTab(path)) activateTab(path);
}

const DIFF_SUFFIX = { M: '(Working Tree)', U: '(Untracked)', D: '(Deleted)' };

/**
 * Opens (or refreshes) the diff tab of a changed file.
 * @param {string} path file path, e.g. "/src/app.js"
 * @param {'M'|'U'|'D'} status
 * @param {string} baseText baseline text ('' for a new file)
 */
export async function openDiffTab(path, status, baseText) {
  const key = `diff:${path}`;
  const name = path.split('/').pop();
  const language = getLanguageFromExtension(name);
  if (status !== 'D' && !(await ensureRealTab(path))) return;

  let file = getOpenFile(key);
  if (!file) {
    addOpenFile(key, { name, language, isVirtual: true });
    file = getOpenFile(key);
    file.isDiff = true;
    file.targetPath = path;
    file.baseModel = monacoNS.editor.createModel(baseText || '', language, monacoNS.Uri.from({ scheme: 'scm-base', path }));
    file.emptyModel = status === 'D' ? monacoNS.editor.createModel('', language, monacoNS.Uri.from({ scheme: 'scm-empty', path })) : null;
  } else if (file.baseModel.getValue() !== (baseText || '')) {
    file.baseModel.setValue(baseText || '');
  }
  file.status = status;
  file.diffSuffix = DIFF_SUFFIX[status];
  activateTab(key);
}

/** Closes diff tabs whose file was renamed/removed (or whose deleted file came back). */
export function pruneDiffTabs() {
  let changed = false;
  for (const [key, f] of Array.from(AppState.openFiles)) {
    if (!f.isDiff) continue;
    const exists = !!findFileByPath(AppState.fileSystem, f.targetPath);
    if ((f.status === 'D') === exists) { removeOpenFile(key); changed = true; }
  }
  if (!changed) return;
  if (AppState.activeFilePath && getOpenFile(AppState.activeFilePath)) activateTab(AppState.activeFilePath);
  else if (!AppState.activeFilePath) { hideImagePreview(); hideDiff(); AppState.editorInstance.setModel(null); showEmptyState(); renderTabs(); }
}

/** Closes the diff tabs of the given file paths (after they were committed or discarded). */
export function closeDiffTabsFor(paths) {
  const set = new Set(paths);
  for (const [key, f] of Array.from(AppState.openFiles)) if (f.isDiff && set.has(f.targetPath)) forceCloseTab(key);
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
    <button type="button" class="image-zoom-btn" data-zoom="out" title="Zoom out"><i class="zi zi-dash"></i></button>
    <span class="image-zoom-level">100%</span>
    <button type="button" class="image-zoom-btn" data-zoom="in" title="Zoom in"><i class="zi zi-add"></i></button>
    <button type="button" class="image-zoom-btn" data-zoom="reset" title="Fit to window"><i class="zi zi-screen-full"></i></button>
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

// A diff tab shows the file's own model on its right side: closing the file closes its diffs too.
function removeOpenFileWithDiffs(path) {
  for (const [key, f] of Array.from(AppState.openFiles)) {
    if (f.isDiff && f.targetPath === path) removeOpenFile(key);
  }
  removeOpenFile(path);
}

function finalizeTabRemoval(path) {
  removeOpenFileWithDiffs(path);
  if (AppState.activeFilePath) {
    activateTab(AppState.activeFilePath);
  } else {
    hideImagePreview();
    hideDiff();
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
  const tabEl = tabsContainer.querySelector(`.editor-tab[data-path="${CSS.escape(path)}"]`);
  // The unsaved dot lives in the close button's slot (CSS swaps it for an X on hover), exactly like VS Code.
  if (tabEl) tabEl.classList.toggle('modified', !!modified);
}

function showEmptyState() { if (editorHostEl) editorHostEl.classList.add('editor-empty'); }
function hideEmptyState() { if (editorHostEl) editorHostEl.classList.remove('editor-empty'); }

export async function saveFile(path) {
  const file = getOpenFile(path);
  if (!file) return false;
  if (file.isImage) return false; // images have no editable model to save
  if (file.isDiff) return file.targetPath && getOpenFile(file.targetPath) ? saveFile(file.targetPath) : false; // saving a diff saves its file
  if (file.custom) return saveCustomDocument(path, file); // validated and applied, never written to disk

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

  await runWillSave(path, file.model); // extensions (e.g. Save Actions) may adjust the text first

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
    document.dispatchEvent(new CustomEvent('zern:file-saved', { detail: { path } }));
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
  // Ctrl+Q opens Monaco's REAL Command Palette (editor.action.quickCommand),
  // with all of the app's commands registered as native actions.
  defineCommand('app.commandPalette', { label: 'Show All Commands', key: 'Ctrl+Q', global: true, run: () => openCommandPalette() });
  defineCommand('app.tab.close', {
    label: 'View: Close Editor Tab', key: 'Ctrl+W', global: true,
    when: () => !!AppState.activeFilePath,
    run: () => closeTab(AppState.activeFilePath),
  });
}

function setupContentChangeTracking() {
  window.addEventListener('beforeunload', (e) => {
    let anyModified = false;
    for (const file of AppState.openFiles.values()) { if (file.modified) { anyModified = true; break; } }
    if (anyModified) { e.preventDefault(); e.returnValue = ''; }
  });
}

export function getMonacoNS() { return monacoNS; }

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

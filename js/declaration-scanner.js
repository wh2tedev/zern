// ============================================================
// declaration-scanner.js - Lightweight, regex-based "declared
// symbols" completion. Not a real language server - it scans
// open files for function/class/variable declarations and
// offers them as completions with the right icon (Function,
// Class, Variable...) instead of Monaco's generic word-based
// "Text" suggestions. Cheap, no dependencies, works offline.
// ============================================================

import { AppState } from './state.js';

// Names caught by a pattern that are actually just language
// keywords (mostly relevant to the loose "name(...) {" pattern
// used for C-family languages, which would otherwise also match
// control-flow statements like "if (...) {").
const KEYWORD_BLOCKLIST = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'def', 'func', 'fn',
  'class', 'struct', 'enum', 'interface', 'do', 'else', 'try', 'using', 'new', 'delete',
  'sizeof', 'typeof', 'instanceof', 'foreach', 'when', 'case', 'lock',
]);

// Each entry: { regex, kind }. `kind` maps to a Monaco CompletionItemKind
// further down. Patterns are intentionally simple (not a real parser) -
// good enough to catch the common declaration shapes per language.
const jsPatterns = [
  { regex: /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { regex: /\bclass\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, kind: 'function' },
  { regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, kind: 'variable' },
];

const LANGUAGE_PATTERNS = {
  javascript: jsPatterns,
  typescript: jsPatterns,
  python: [
    { regex: /\bdef\s+([A-Za-z_]\w*)\s*\(/g, kind: 'function' },
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /^[ \t]*([A-Za-z_]\w*)\s*=(?!=)/gm, kind: 'variable' },
  ],
  php: [
    { regex: /\bfunction\s+([A-Za-z_]\w*)\s*\(/g, kind: 'function' },
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /(\$[A-Za-z_]\w*)\s*=/g, kind: 'variable' },
  ],
  java: [
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\binterface\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g, kind: 'function' },
  ],
  csharp: [
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\binterface\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g, kind: 'function' },
  ],
  cpp: [
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\bstruct\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g, kind: 'function' },
  ],
  c: [
    { regex: /\bstruct\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g, kind: 'function' },
  ],
  go: [
    { regex: /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g, kind: 'function' },
    { regex: /\btype\s+([A-Za-z_]\w*)\s+struct/g, kind: 'class' },
  ],
  rust: [
    { regex: /\bfn\s+([A-Za-z_]\w*)/g, kind: 'function' },
    { regex: /\bstruct\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\benum\s+([A-Za-z_]\w*)/g, kind: 'class' },
  ],
  ruby: [
    { regex: /\bdef\s+([A-Za-z_]\w*[!?=]?)/g, kind: 'function' },
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
  ],
  kotlin: [
    { regex: /\bfun\s+([A-Za-z_]\w*)/g, kind: 'function' },
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
  ],
  swift: [
    { regex: /\bfunc\s+([A-Za-z_]\w*)/g, kind: 'function' },
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\bstruct\s+([A-Za-z_]\w*)/g, kind: 'class' },
  ],
  dart: [
    { regex: /\bclass\s+([A-Za-z_]\w*)/g, kind: 'class' },
    { regex: /\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g, kind: 'function' },
  ],
};

// Cache scan results per model, invalidated only when the model's
// content actually changes (Monaco bumps getVersionId() on every
// edit) - so we don't re-scan on every single keystroke's completion
// request, just once per edit.
const declarationCache = new WeakMap();

function scanDeclarations(text, patterns) {
  const found = new Map();
  for (const { regex, kind } of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      const name = match[1];
      if (!name || name.length < 2) continue;
      if (KEYWORD_BLOCKLIST.has(name)) continue;
      if (!found.has(name)) found.set(name, kind);
    }
  }
  return found;
}

function getDeclarationsForModel(model, patterns) {
  const version = model.getVersionId();
  const cached = declarationCache.get(model);
  if (cached && cached.version === version) return cached.map;

  const map = scanDeclarations(model.getValue(), patterns);
  declarationCache.set(model, { version, map });
  return map;
}

function wordRangeAt(model, position) {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
}

function buildSuggestion(monacoNS, name, kind, range, sourceLabel) {
  const kindMap = {
    function: monacoNS.languages.CompletionItemKind.Function,
    class: monacoNS.languages.CompletionItemKind.Class,
    variable: monacoNS.languages.CompletionItemKind.Variable,
  };
  return {
    label: name,
    kind: kindMap[kind] || monacoNS.languages.CompletionItemKind.Variable,
    insertText: name,
    detail: `${kind} - ${sourceLabel}`,
    // Nudge these above generic word-based (Text-kind) suggestions,
    // which sort further down by default.
    sortText: `0${name}`,
  };
}

export function setupDeclarationScanner(monacoNS) {
  Object.keys(LANGUAGE_PATTERNS).forEach((lang) => {
    const patterns = LANGUAGE_PATTERNS[lang];

    monacoNS.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems(model, position) {
        const range = wordRangeAt(model, position);
        const suggestions = [];

        const ownDeclarations = getDeclarationsForModel(model, patterns);
        ownDeclarations.forEach((kind, name) => {
          suggestions.push(buildSuggestion(monacoNS, name, kind, range, 'this file'));
        });

        // Bonus: also surface declarations from other currently OPEN
        // files of the same language, so switching between a component
        // and its helper file still gets you cross-file suggestions -
        // without needing a real multi-file language server.
        for (const file of AppState.openFiles.values()) {
          if (!file.model || file.model === model || file.language !== lang) continue;
          const otherDeclarations = getDeclarationsForModel(file.model, patterns);
          otherDeclarations.forEach((kind, name) => {
            if (ownDeclarations.has(name)) return; // this file's own declaration wins
            suggestions.push(buildSuggestion(monacoNS, name, kind, range, file.name));
          });
        }

        return { suggestions };
      },
    });
  });
}

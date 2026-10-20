// ============================================================
// search.js - Text search across every file in the project
// (real via the File System Access API, or virtual), with
// clickable results that jump to the exact line, plus Find
// & Replace (single match or all matches at once).
// ============================================================

import { AppState, getOpenFile, markFileModified } from './state.js';
import { getLanguageFromExtension, normalizePath, walkTree, findFileByPath } from './fs-utils.js';
import { openFileInEditor, scheduleVirtualFsSave, updateTabModifiedIndicator } from './editor.js';
import { updateExplorerModifiedIndicator } from './explorer.js';
import { getFileIcon } from './icons.js';
import { showToast } from './notifications.js';
import { escapeHtml } from './escape.js';

let inputEl, resultsEl, summaryEl, clearBtn, replaceInputEl, replaceAllBtn;
let debounceTimer = null;
let searchToken = 0; // prevents a stale search from overwriting a newer one
let lastFileResults = [];

// Search runs in a Web Worker so large projects don't freeze the UI
// while scanning file contents. If the worker can't be created, or a
// browser doesn't support transferring FileSystemHandle objects to a
// worker, we transparently fall back to running the exact same search
// on the main thread - the user never sees a difference either way.
let searchWorker = null;
let workerUsable = true;
const pendingWorkerRequests = new Map();

function getSearchWorker() {
  if (searchWorker || !workerUsable) return searchWorker;
  try {
    searchWorker = new Worker(new URL('./search-worker.js', import.meta.url));
    searchWorker.onmessage = (e) => {
      const { requestId, results, error } = e.data;
      const pending = pendingWorkerRequests.get(requestId);
      if (!pending) return;
      pendingWorkerRequests.delete(requestId);
      if (error) pending.reject(new Error(error));
      else pending.resolve(results);
    };
    searchWorker.onerror = (err) => {
      console.warn('Search worker crashed, falling back to main-thread search:', err.message);
      workerUsable = false;
      searchWorker = null;
    };
  } catch (err) {
    console.warn('Could not create the search worker, falling back to main-thread search:', err);
    workerUsable = false;
    searchWorker = null;
  }
  return searchWorker;
}

function searchInWorker(qLower) {
  const worker = getSearchWorker();
  if (!worker) return Promise.reject(new Error('worker unavailable'));

  const requestId = `${Date.now()}-${Math.random()}`;
  const payload = AppState.isRealFS && AppState.rootDirHandle
    ? { requestId, mode: 'real', qLower, rootHandle: AppState.rootDirHandle }
    : { requestId, mode: 'virtual', qLower, virtualTree: AppState.fileSystem };

  return new Promise((resolve, reject) => {
    pendingWorkerRequests.set(requestId, { resolve, reject });
    try {
      worker.postMessage(payload);
    } catch (err) {
      pendingWorkerRequests.delete(requestId);
      reject(err);
    }
  });
}

const BINARY_EXT_BLOCKLIST = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'pdf', 'zip', 'rar', '7z', 'gz', 'tar',
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov',
  'wasm', 'exe', 'dll', 'so', 'bin',
]);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB per file
const MAX_MATCHES_PER_FILE = 200;
const MAX_MATCHES_SHOWN_PER_FILE = 50;

export function initSearchPanel({ input, results, summary, clear, replaceInput, replaceAll }) {
  inputEl = input;
  resultsEl = results;
  summaryEl = summary;
  clearBtn = clear;
  replaceInputEl = replaceInput;
  replaceAllBtn = replaceAll;

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = inputEl.value;
    clearBtn.style.display = query ? 'flex' : 'none';
    if (!query.trim()) { renderEmpty(); return; }
    debounceTimer = setTimeout(() => runSearch(query), 300);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimer);
      runSearch(inputEl.value);
    }
  });

  clearBtn.addEventListener('click', () => {
    inputEl.value = '';
    clearBtn.style.display = 'none';
    renderEmpty();
    inputEl.focus();
  });

  if (replaceAllBtn) {
    replaceAllBtn.addEventListener('click', () => runReplaceAll());
  }

  renderEmpty();
}

/** Focuses the search input (called when the Search panel opens). */
export function focusSearchInput() {
  if (inputEl) inputEl.focus();
}

function renderEmpty() {
  summaryEl.textContent = '';
  resultsEl.innerHTML = '';
  lastFileResults = [];
}

async function runSearch(query) {
  const q = query.trim();
  if (!q) { renderEmpty(); return; }

  const token = ++searchToken;
  resultsEl.innerHTML = '<div class="search-loading">Searching...</div>';
  summaryEl.textContent = '';

  const qLower = q.toLowerCase();
  let fileResults = [];

  try {
    fileResults = await searchInWorker(qLower);
  } catch (err) {
    // Worker unavailable or it failed for this search - fall back to
    // running the identical search on the main thread instead.
    if (workerUsable) console.warn('Search worker failed, falling back to main thread:', err.message);
    try {
      if (AppState.isRealFS && AppState.rootDirHandle) {
        fileResults = await searchRealFs(AppState.rootDirHandle, '/', qLower);
      } else {
        fileResults = searchVirtualFs(AppState.fileSystem, qLower);
      }
    } catch (fallbackErr) {
      console.error('Error searching files:', fallbackErr);
    }
  }

  if (token !== searchToken) return; // a newer search already started in the meantime
  lastFileResults = fileResults;
  renderResults(q, fileResults);
}

async function searchRealFs(dirHandle, path, qLower, acc = []) {
  for await (const [name, handle] of dirHandle.entries()) {
    const entryPath = normalizePath(`${path === '/' ? '' : path}/${name}`);
    if (handle.kind === 'directory') {
      await searchRealFs(handle, entryPath, qLower, acc);
    } else {
      const dot = name.lastIndexOf('.');
      const ext = dot > -1 ? name.slice(dot + 1).toLowerCase() : '';
      if (BINARY_EXT_BLOCKLIST.has(ext)) continue;

      try {
        const file = await handle.getFile();
        if (file.size > MAX_FILE_SIZE) continue;
        const content = await file.text();
        const matches = findMatches(content, qLower);
        if (matches.length) {
          acc.push({ path: entryPath, name, content, handle, isVirtual: false, matches });
        }
      } catch {
        // not readable as text (binary, permission, etc.): skip it
      }
    }
  }
  return acc;
}

function searchVirtualFs(root, qLower) {
  const acc = [];
  walkTree(root, (node) => {
    if (node.type === 'file') {
      const content = node.content || '';
      const matches = findMatches(content, qLower);
      if (matches.length) {
        acc.push({ path: node.path, name: node.name, content, node, isVirtual: true, matches });
      }
    }
  });
  return acc;
}

function findMatches(content, qLower) {
  if (!qLower) return [];
  const lines = content.split('\n');
  const matches = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const lineText = lines[idx];
    const lower = lineText.toLowerCase();
    let from = 0;
    let pos;
    while ((pos = lower.indexOf(qLower, from)) !== -1) {
      matches.push({ lineNumber: idx + 1, lineText, matchStart: pos, matchEnd: pos + qLower.length });
      from = pos + qLower.length;
      if (matches.length >= MAX_MATCHES_PER_FILE) return matches;
    }
  }
  return matches;
}

function renderResults(query, fileResults) {
  resultsEl.innerHTML = '';
  const totalMatches = fileResults.reduce((sum, f) => sum + f.matches.length, 0);

  if (totalMatches === 0) {
    summaryEl.textContent = 'No results';
    resultsEl.innerHTML = `<div class="search-empty">No matches found for "${escapeHtml(query)}".</div>`;
    return;
  }

  summaryEl.textContent = `${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${fileResults.length} file${fileResults.length !== 1 ? 's' : ''}`;

  fileResults.forEach((fileResult) => {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'search-file-group';

    const fileHeader = document.createElement('div');
    fileHeader.className = 'search-file-header';

    const icon = document.createElement('span');
    icon.className = 'search-file-icon';
    icon.innerHTML = getFileIcon(fileResult.name);

    const name = document.createElement('span');
    name.className = 'search-file-name';
    name.textContent = fileResult.name;
    name.title = fileResult.path;

    const count = document.createElement('span');
    count.className = 'search-file-count';
    count.textContent = fileResult.matches.length;

    fileHeader.appendChild(icon);
    fileHeader.appendChild(name);
    const replaceFileBtn = document.createElement('button');
    replaceFileBtn.className = 'search-replace-file';
    replaceFileBtn.title = 'Replace all matches in this file';
    replaceFileBtn.innerHTML = '<i class="zi zi-replace-all"></i>';
    replaceFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runReplaceInFile(fileResult);
    });

    fileHeader.appendChild(count);
    fileHeader.appendChild(replaceFileBtn);
    fileGroup.appendChild(fileHeader);

    const matchList = document.createElement('ul');
    matchList.className = 'search-match-list';

    fileResult.matches.slice(0, MAX_MATCHES_SHOWN_PER_FILE).forEach((match) => {
      const li = document.createElement('li');
      li.className = 'search-match-row';

      const lineNum = document.createElement('span');
      lineNum.className = 'search-match-line';
      lineNum.textContent = match.lineNumber;

      const preview = document.createElement('span');
      preview.className = 'search-match-preview';
      const before = escapeHtml(match.lineText.slice(0, match.matchStart).trimStart());
      const hit = escapeHtml(match.lineText.slice(match.matchStart, match.matchEnd));
      const after = escapeHtml(match.lineText.slice(match.matchEnd));
      preview.innerHTML = `${before}<mark>${hit}</mark>${after}`;

      const replaceOneBtn = document.createElement('button');
      replaceOneBtn.className = 'search-replace-one';
      replaceOneBtn.title = 'Replace this match';
      replaceOneBtn.innerHTML = '<i class="zi zi-replace"></i>';
      replaceOneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        runReplaceOne(fileResult, match);
      });

      li.appendChild(lineNum);
      li.appendChild(preview);
      li.appendChild(replaceOneBtn);
      li.addEventListener('click', () => openMatch(fileResult, match));
      matchList.appendChild(li);
    });

    fileGroup.appendChild(matchList);
    resultsEl.appendChild(fileGroup);
  });
}

function openMatch(fileResult, match) {
  const language = getLanguageFromExtension(fileResult.name);
  openFileInEditor({
    path: fileResult.path,
    name: fileResult.name,
    content: fileResult.content,
    language,
    handle: fileResult.isVirtual ? null : fileResult.handle,
    isVirtual: fileResult.isVirtual,
  });

  if (AppState.editorInstance) {
    const range = {
      startLineNumber: match.lineNumber,
      startColumn: match.matchStart + 1,
      endLineNumber: match.lineNumber,
      endColumn: match.matchEnd + 1,
    };
    AppState.editorInstance.revealRangeInCenter(range);
    AppState.editorInstance.setSelection(range);
    AppState.editorInstance.focus();
  }

  document.dispatchEvent(new CustomEvent('zern:file-opened'));
}

// ---------------- Find & Replace ----------------

function computeReplacedContent(content, matches, replacementText) {
  const lines = content.split('\n');
  const byLine = new Map();
  matches.forEach((m) => {
    if (!byLine.has(m.lineNumber)) byLine.set(m.lineNumber, []);
    byLine.get(m.lineNumber).push(m);
  });

  byLine.forEach((lineMatches, lineNumber) => {
    let line = lines[lineNumber - 1];
    lineMatches
      .slice()
      .sort((a, b) => b.matchStart - a.matchStart) // rightmost first, so earlier indices stay valid
      .forEach((m) => {
        line = line.slice(0, m.matchStart) + replacementText + line.slice(m.matchEnd);
      });
    lines[lineNumber - 1] = line;
  });

  return lines.join('\n');
}

async function replaceInFile(fileResult, matches, replacementText) {
  const newContent = computeReplacedContent(fileResult.content, matches, replacementText);

  if (fileResult.isVirtual) {
    const node = findFileByPath(AppState.fileSystem, fileResult.path);
    if (node) node.content = newContent;
    scheduleVirtualFsSave();
  } else {
    const writable = await fileResult.handle.createWritable();
    await writable.write(newContent);
    await writable.close();
  }

  const openFile = getOpenFile(fileResult.path);
  if (openFile && openFile.model) {
    const fullRange = openFile.model.getFullModelRange();
    openFile.model.pushEditOperations([], [{ range: fullRange, text: newContent }], () => null);
    openFile.savedContent = newContent;
    openFile.content = newContent;
    markFileModified(fileResult.path, false);
    updateTabModifiedIndicator(fileResult.path, false);
    updateExplorerModifiedIndicator(fileResult.path, false);
  }

  fileResult.content = newContent;
}

async function runReplaceOne(fileResult, match) {
  const replacementText = replaceInputEl ? replaceInputEl.value : '';
  try {
    await replaceInFile(fileResult, [match], replacementText);
    showToast({ type: 'success', message: `Replaced 1 match in "${fileResult.name}"`, timeout: 2000 });
  } catch (err) {
    console.error('Error replacing match:', err);
    showToast({ type: 'error', message: `Could not replace in "${fileResult.name}": ${err.message}` });
  }
  if (inputEl.value.trim()) runSearch(inputEl.value);
}

async function runReplaceInFile(fileResult) {
  const replacementText = replaceInputEl ? replaceInputEl.value : '';
  try {
    await replaceInFile(fileResult, fileResult.matches, replacementText);
    showToast({ type: 'success', message: `Replaced ${fileResult.matches.length} match(es) in "${fileResult.name}"` });
  } catch (err) {
    console.error('Error replacing in file:', err);
    showToast({ type: 'error', message: `Could not replace in "${fileResult.name}": ${err.message}` });
  }
  if (inputEl.value.trim()) runSearch(inputEl.value);
}

async function runReplaceAll() {
  const query = inputEl.value.trim();
  if (!query) return;
  if (!lastFileResults.length) return;

  const replacementText = replaceInputEl ? replaceInputEl.value : '';
  const totalMatches = lastFileResults.reduce((sum, f) => sum + f.matches.length, 0);

  let replacedFiles = 0;
  for (const fileResult of lastFileResults) {
    try {
      await replaceInFile(fileResult, fileResult.matches, replacementText);
      replacedFiles += 1;
    } catch (err) {
      console.error(`Error replacing in "${fileResult.name}":`, err);
      showToast({ type: 'error', message: `Could not replace in "${fileResult.name}": ${err.message}` });
    }
  }

  showToast({
    type: 'success',
    message: `Replaced ${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in ${replacedFiles} file${replacedFiles !== 1 ? 's' : ''}`,
  });

  runSearch(query);
}

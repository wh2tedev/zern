// ============================================================
// quick-open.js - "Go to File" (Ctrl+P): fuzzy-find any file in
// the current project by name and jump straight to it. Works
// against the real filesystem (walks the real folder tree) or
// the virtual one, same as the rest of the app.
// ============================================================

import { AppState } from './state.js';
import { normalizePath, getLanguageFromExtension, walkTree, findFileByPath } from './fs-utils.js';
import { openFileInEditor } from './editor.js';
import { openRealFile } from './explorer.js';
import { getFileIcon } from './icons.js';

let overlayEl, inputEl, listEl;
let filtered = [];
let activeIndex = 0;
let cachedFiles = [];

export function initQuickOpen({ overlay, input, list }) {
  overlayEl = overlay;
  inputEl = input;
  listEl = list;

  inputEl.addEventListener('input', () => renderResults(inputEl.value));
  inputEl.addEventListener('keydown', onKeydown);
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeQuickOpen(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeQuickOpen();
  });
}

export async function openQuickOpen() {
  if (!overlayEl) return;
  const allFiles = await collectAllFiles();
  overlayEl.classList.add('open');
  inputEl.value = '';
  renderResults('', allFiles);
  inputEl.focus();
}

function closeQuickOpen() {
  if (overlayEl) overlayEl.classList.remove('open');
}

async function collectAllFiles() {
  cachedFiles = [];
  try {
    if (AppState.isRealFS && AppState.rootDirHandle) {
      await walkRealDirLight(AppState.rootDirHandle, '/', cachedFiles);
    } else {
      walkTree(AppState.fileSystem, (node) => {
        if (node.type === 'file') cachedFiles.push({ path: node.path, name: node.name, isVirtual: true });
      });
    }
  } catch (err) {
    console.warn('Quick Open: could not list all files:', err);
  }
  return cachedFiles;
}

async function walkRealDirLight(dirHandle, path, acc) {
  for await (const [name, handle] of dirHandle.entries()) {
    const entryPath = normalizePath(`${path === '/' ? '' : path}/${name}`);
    if (handle.kind === 'directory') {
      await walkRealDirLight(handle, entryPath, acc);
    } else {
      acc.push({ path: entryPath, name, handle, isVirtual: false });
    }
  }
}

// Simple subsequence-based fuzzy match: every character of the query
// must appear in order somewhere in the target, consecutive/early
// matches score higher. Returns -1 when the query doesn't match at all.
function fuzzyScore(query, target) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let consecutive = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10 + consecutive * 5;
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
  }
  return qi === q.length ? score : -1;
}

function renderResults(query, allFiles = cachedFiles) {
  const scored = allFiles
    .map((f) => ({ ...f, score: fuzzyScore(query, f.path) }))
    .filter((f) => f.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  filtered = scored;
  activeIndex = 0;
  listEl.innerHTML = '';

  if (!filtered.length) {
    listEl.innerHTML = '<li class="quick-open-empty">No matching files</li>';
    return;
  }

  filtered.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'quick-open-item' + (i === 0 ? ' active' : '');

    const icon = document.createElement('span');
    icon.className = 'quick-open-icon';
    icon.innerHTML = getFileIcon(f.name);

    const nameEl = document.createElement('span');
    nameEl.className = 'quick-open-name';
    nameEl.textContent = f.name;

    const pathEl = document.createElement('span');
    pathEl.className = 'quick-open-path';
    pathEl.textContent = f.path;

    li.appendChild(icon);
    li.appendChild(nameEl);
    li.appendChild(pathEl);
    li.addEventListener('click', () => selectFile(f));
    li.addEventListener('mouseenter', () => { activeIndex = i; updateActiveVisual(); });
    listEl.appendChild(li);
  });
}

function updateActiveVisual() {
  Array.from(listEl.children).forEach((li, i) => li.classList.toggle('active', i === activeIndex));
  const activeLi = listEl.children[activeIndex];
  if (activeLi) activeLi.scrollIntoView({ block: 'nearest' });
}

function onKeydown(e) {
  if (!filtered.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % filtered.length; updateActiveVisual(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + filtered.length) % filtered.length; updateActiveVisual(); }
  else if (e.key === 'Enter') { e.preventDefault(); selectFile(filtered[activeIndex]); }
}

async function selectFile(f) {
  if (!f) return;
  closeQuickOpen();

  try {
    if (f.isVirtual) {
      const node = findFileByPath(AppState.fileSystem, f.path);
      if (!node) return;
      openFileInEditor({
        path: node.path, name: node.name, content: node.content ?? '',
        language: getLanguageFromExtension(node.name), handle: null, isVirtual: true,
      });
    } else {
      await openRealFile(f.handle, f.path, f.name);
    }
  } catch (err) {
    console.error('Quick Open: could not open file:', err);
  }

  document.dispatchEvent(new CustomEvent('kcode:file-opened'));
}

// ============================================================
// explorer.js - Explorer engine (real + virtual) with rename,
// delete, create, context menu, and a tree that mirrors VS Code
// (animated twisty + indentation guides)
// ============================================================

import { AppState, getOpenFile } from './state.js';
import { getLanguageFromExtension, normalizePath, sortTree, findFileByPath, findFolderByPath, isImageExtension } from './fs-utils.js';
import { verifyPermission, saveDirectoryHandle, addRecentFolder } from './db.js';
import { openFileInEditor, forceCloseTab, renameOpenFile, scheduleVirtualFsSave } from './editor.js';
import { getFileIcon, getFolderIcon, MENU_ICONS } from './icons.js';
import { showContextMenu } from './context-menu.js';
import { showToast } from './notifications.js';
import { confirmDialog } from './dialogs.js';
import {
  realRenameFile, realRenameFolder, realDeleteEntry, realCreateFile, realCreateFolder,
  realMoveFolder, virtualRename, virtualDelete, virtualCreateFile, virtualCreateFolder,
  virtualMoveFolder, getParentPath,
} from './file-ops.js';

let explorerContainer = null;
const realHandleCache = new Map();
const folderState = new Map();

let hoveredPath = null;
let hoveredType = null;
let hoveredName = null;

// Drag & drop of files AND folders between folders
let draggedItemPath = null;
let draggedItemType = null; // 'file' | 'folder'

// FIX: lets app.js set the container BEFORE the first render, so
// pickRealDirectory() never receives explorerContainer = null.
export function setExplorerContainer(container) {
  explorerContainer = container;
  bindContainerEvents(container);
}

export async function renderExplorer(container) {
  explorerContainer = container;
  bindContainerEvents(container);

  container.innerHTML = '';
  realHandleCache.clear();
  folderState.clear();

  const rootUl = document.createElement('ul');
  rootUl.className = 'explorer-tree';

  if (AppState.isRealFS && AppState.rootDirHandle) {
    const loadingEl = document.createElement('div');
    loadingEl.className = 'explorer-loading';
    loadingEl.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i><span>Loading folder...</span>';
    container.appendChild(loadingEl);

    realHandleCache.set('/', { handle: AppState.rootDirHandle, kind: 'directory', parentHandle: null });
    folderState.set('/', {
      ul: rootUl, isVirtual: false, depth: 0,
      realHandle: AppState.rootDirHandle, parentHandle: null,
      get isExpanded() { return true; },
      expand: async () => {},
    });
    await renderRealFolder(AppState.rootDirHandle, '/', rootUl, 0);

    loadingEl.remove();
    container.appendChild(rootUl);
  } else {
    container.appendChild(rootUl);
    sortTree(AppState.fileSystem);
    folderState.set('/', {
      ul: rootUl, isVirtual: true, depth: 0, node: AppState.fileSystem,
      get isExpanded() { return true; },
      expand: async () => {},
    });
    renderVirtualFolder(AppState.fileSystem, rootUl, 0);
  }
}

function bindContainerEvents(container) {
  if (container.dataset.boundEvents) return;
  container.dataset.boundEvents = '1';

  container.addEventListener('contextmenu', (e) => {
    if (e.target === container || e.target.classList.contains('explorer-tree')) {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New File...', icon: MENU_ICONS.newFile, action: () => startCreateEntry('/', 'file') },
        { label: 'New Folder...', icon: MENU_ICONS.newFolder, action: () => startCreateEntry('/', 'folder') },
      ]);
    }
  });

  container.addEventListener('mouseleave', () => {
    hoveredPath = null; hoveredType = null; hoveredName = null;
  });

  // Dropping a dragged item on the tree's empty space moves it back
  // to the project root.
  const isEmptySpace = (target) => target === container || target.classList.contains('explorer-tree');

  container.addEventListener('dragover', (e) => {
    if (!draggedItemPath || !isEmptySpace(e.target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.classList.add('drag-over-root');
  });
  container.addEventListener('dragleave', (e) => {
    if (isEmptySpace(e.target)) container.classList.remove('drag-over-root');
  });
  container.addEventListener('drop', async (e) => {
    if (!draggedItemPath || !isEmptySpace(e.target)) return;
    e.preventDefault();
    container.classList.remove('drag-over-root');
    await handleDrop(draggedItemPath, draggedItemType, '/');
  });
}

document.addEventListener('keydown', (e) => {
  if (!hoveredPath) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'F2') {
    e.preventDefault();
    startRenameEntry(hoveredPath, hoveredType, hoveredName);
  } else if (e.key === 'Delete') {
    e.preventDefault();
    deleteEntryByPath(hoveredPath, hoveredType, hoveredName);
  }
});

// ---------------- Row construction (mirrors VS Code) ----------------

// Every row is made of: [indentation guides] [twisty] [icon] [label].
// The guides are one vertical line per nesting level (just like VS
// Code's real tree); the twisty is the little arrow that rotates 90°
// when a folder expands/collapses (files get an empty twisty, just to
// keep them aligned with their sibling folders).
function buildRowSkeleton(depth) {
  const row = document.createElement('div');
  row.className = 'explorer-row';

  for (let i = 0; i < depth; i++) {
    const guide = document.createElement('span');
    guide.className = 'indent-guide';
    row.appendChild(guide);
  }

  const twistyEl = document.createElement('span');
  twistyEl.className = 'explorer-twisty';

  const iconEl = document.createElement('span');
  iconEl.className = 'explorer-icon';

  row.appendChild(twistyEl);
  row.appendChild(iconEl);

  return { row, twistyEl, iconEl };
}

// ---------------- Virtual tree ----------------

function renderVirtualFolder(folderNode, parentUl, depth) {
  for (const child of folderNode.children || []) {
    const li = document.createElement('li');
    li.dataset.path = child.path;
    li.className = child.type === 'folder' ? 'explorer-folder' : 'explorer-file';

    const { row, twistyEl, iconEl } = buildRowSkeleton(depth);

    const label = document.createElement('span');
    label.className = 'explorer-label';
    label.textContent = child.name;
    row.appendChild(label);
    li.appendChild(row);

    if (child.type === 'folder') {
      twistyEl.innerHTML = '<i class="codicon codicon-chevron-right"></i>';
      twistyEl.classList.toggle('expanded', !!child.expanded);
      iconEl.innerHTML = getFolderIcon(child.expanded);

      const childUl = document.createElement('ul');
      childUl.className = 'explorer-subtree';
      childUl.style.display = child.expanded ? 'block' : 'none';
      renderVirtualFolder(child, childUl, depth + 1);
      li.appendChild(childUl);

      folderState.set(child.path, {
        ul: childUl, isVirtual: true, depth: depth + 1, node: child, twistyEl,
        get isExpanded() { return child.expanded; },
        expand: async () => {
          if (!child.expanded) {
            child.expanded = true;
            iconEl.innerHTML = getFolderIcon(true);
            twistyEl.classList.add('expanded');
            childUl.style.display = 'block';
          }
        },
      });

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        child.expanded = !child.expanded;
        iconEl.innerHTML = getFolderIcon(child.expanded);
        twistyEl.classList.toggle('expanded', child.expanded);
        childUl.style.display = child.expanded ? 'block' : 'none';
      });

      row.addEventListener('mouseenter', () => setHovered(child.path, 'folder', child.name));
      row.addEventListener('contextmenu', (e) => onEntryContextMenu(e, child.path, 'folder', child.name));
      bindDragSource(li, row, child.path, 'folder');
      bindFolderDropTarget(row, child.path);
    } else {
      iconEl.innerHTML = getFileIcon(child.name);

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        openVirtualFile(child);
        highlightActiveRow(child.path);
        notifyFileOpened();
      });
      row.addEventListener('mouseenter', () => setHovered(child.path, 'file', child.name));
      row.addEventListener('contextmenu', (e) => onEntryContextMenu(e, child.path, 'file', child.name));
      bindDragSource(li, row, child.path, 'file');
    }

    parentUl.appendChild(li);
  }
}

function openVirtualFile(fileNode) {
  const language = getLanguageFromExtension(fileNode.name);
  openFileInEditor({
    path: fileNode.path, name: fileNode.name, content: fileNode.content ?? '',
    language, handle: null, isVirtual: true,
  });
}

// ---------------- Real tree (File System Access API) ----------------

async function renderRealFolder(dirHandle, path, parentUl, depth) {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) entries.push({ name, handle });

  entries.sort((a, b) => {
    const aDir = a.handle.kind === 'directory', bDir = b.handle.kind === 'directory';
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });

  for (const { name, handle } of entries) {
    const entryPath = normalizePath(`${path === '/' ? '' : path}/${name}`);
    realHandleCache.set(entryPath, { handle, kind: handle.kind, parentHandle: dirHandle });

    const li = document.createElement('li');
    li.dataset.path = entryPath;

    const { row, twistyEl, iconEl } = buildRowSkeleton(depth);

    const label = document.createElement('span');
    label.className = 'explorer-label';
    label.textContent = name;
    row.appendChild(label);
    li.appendChild(row);

    if (handle.kind === 'directory') {
      li.className = 'explorer-folder';
      twistyEl.innerHTML = '<i class="codicon codicon-chevron-right"></i>';
      iconEl.innerHTML = getFolderIcon(false);

      const childUl = document.createElement('ul');
      childUl.className = 'explorer-subtree';
      childUl.style.display = 'none';
      li.appendChild(childUl);

      let expanded = false;
      let loaded = false;

      const doExpand = async () => {
        if (expanded) return;
        expanded = true;
        iconEl.innerHTML = getFolderIcon(true);
        twistyEl.classList.add('expanded');
        childUl.style.display = 'block';
        if (!loaded) {
          loaded = true;
          await renderRealFolder(handle, entryPath, childUl, depth + 1);
        }
      };

      folderState.set(entryPath, {
        ul: childUl, isVirtual: false, depth: depth + 1,
        realHandle: handle, parentHandle: dirHandle, twistyEl,
        get isExpanded() { return expanded; },
        expand: doExpand,
      });

      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (expanded) {
          expanded = false;
          iconEl.innerHTML = getFolderIcon(false);
          twistyEl.classList.remove('expanded');
          childUl.style.display = 'none';
        } else {
          await doExpand();
        }
      });

      row.addEventListener('mouseenter', () => setHovered(entryPath, 'folder', name));
      row.addEventListener('contextmenu', (e) => onEntryContextMenu(e, entryPath, 'folder', name));
      bindDragSource(li, row, entryPath, 'folder');
      bindFolderDropTarget(row, entryPath);
    } else {
      li.className = 'explorer-file';
      iconEl.innerHTML = getFileIcon(name);

      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        await openRealFile(handle, entryPath, name);
        highlightActiveRow(entryPath);
        notifyFileOpened();
      });
      row.addEventListener('mouseenter', () => setHovered(entryPath, 'file', name));
      row.addEventListener('contextmenu', (e) => onEntryContextMenu(e, entryPath, 'file', name));
      bindDragSource(li, row, entryPath, 'file');
    }

    parentUl.appendChild(li);
  }
}

export async function openRealFile(fileHandle, path, name) {
  try {
    const hasPermission = await verifyPermission(fileHandle, true);
    if (!hasPermission) {
      showToast({ type: 'error', message: 'Permission denied to access this file.' });
      return;
    }

    if (isImageExtension(name)) {
      const file = await fileHandle.getFile();
      const imageUrl = URL.createObjectURL(file);
      openFileInEditor({ path, name, isImage: true, imageUrl, handle: fileHandle, isVirtual: false });
      return;
    }

    const file = await fileHandle.getFile();
    const content = await file.text();
    const language = getLanguageFromExtension(name);

    openFileInEditor({
      path, name, content, language, handle: fileHandle, isVirtual: false,
      lastModified: file.lastModified,
    });
  } catch (err) {
    console.error('Error opening real file:', err);
    showToast({ type: 'error', message: `Could not open "${name}": ${err.message}` });
  }
}

export function getCachedHandle(path) {
  return realHandleCache.get(normalizePath(path)) || null;
}

// Fired every time a file is opened from the tree. app.js listens for
// this to auto-close the sidebar drawer on phones (see mobile.css) -
// on desktop/tablet nothing listens differently, so this is a no-op
// there beyond the event simply existing.
function notifyFileOpened() {
  document.dispatchEvent(new CustomEvent('kcode:file-opened'));
}

// ---------------- Drag & drop files AND folders (move between folders) ----------------

function bindDragSource(li, row, itemPath, itemType) {
  li.draggable = true;

  li.addEventListener('dragstart', (e) => {
    draggedItemPath = itemPath;
    draggedItemType = itemType;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', itemPath); } catch { /* some mobile browsers don't support this */ }
    row.classList.add('dragging');
  });

  li.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    draggedItemPath = null;
    draggedItemType = null;
    if (explorerContainer) {
      explorerContainer.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      explorerContainer.classList.remove('drag-over-root');
    }
  });
}

// A folder can never be dropped onto itself or onto one of its own
// descendants - that would try to move a folder inside itself.
function isDropTargetValid(targetFolderPath) {
  if (!draggedItemPath) return false;
  if (draggedItemType !== 'folder') return true;
  const target = normalizePath(targetFolderPath);
  const source = normalizePath(draggedItemPath);
  return target !== source && !target.startsWith(source + '/');
}

function bindFolderDropTarget(row, folderPath) {
  row.addEventListener('dragover', (e) => {
    if (!isDropTargetValid(folderPath)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', async (e) => {
    if (!isDropTargetValid(folderPath)) return;
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove('drag-over');
    await handleDrop(draggedItemPath, draggedItemType, folderPath);
  });
}

async function handleDrop(sourcePath, sourceType, targetFolderPath) {
  const normalizedTarget = normalizePath(targetFolderPath);
  const currentParent = getParentPath(sourcePath);
  const itemName = sourcePath.split('/').pop();
  draggedItemPath = null;
  draggedItemType = null;

  if (normalizedTarget === currentParent) return; // already there, nothing to do
  if (sourceType === 'folder' && (normalizedTarget === sourcePath || normalizedTarget.startsWith(sourcePath + '/'))) {
    showToast({ type: 'error', message: 'A folder cannot be moved into itself.' });
    return;
  }

  try {
    let newHandle = null;
    if (sourceType === 'folder') {
      if (AppState.isRealFS) {
        newHandle = await moveFolderReal(sourcePath, normalizedTarget, itemName);
      } else {
        moveFolderVirtual(sourcePath, normalizedTarget, itemName);
      }
      closeTabsUnderFolder(sourcePath);
    } else if (AppState.isRealFS) {
      newHandle = await moveFileReal(sourcePath, normalizedTarget, itemName);
    } else {
      moveFileVirtual(sourcePath, normalizedTarget, itemName);
    }

    const newPath = normalizePath(normalizedTarget === '/' ? `/${itemName}` : `${normalizedTarget}/${itemName}`);
    if (sourceType === 'file' && getOpenFile(sourcePath)) {
      renameOpenFile(sourcePath, newPath, itemName, newHandle);
    }

    showToast({
      type: 'success', message: `"${itemName}" moved successfully.`, timeout: 6000,
      actionLabel: 'Undo',
      onAction: () => handleDrop(newPath, sourceType, currentParent),
    });
  } catch (err) {
    console.error('Error moving item:', err);
    showToast({ type: 'error', message: `Could not move "${itemName}": ${err.message}` });
  }
  await renderExplorer(explorerContainer);
}

function closeTabsUnderFolder(folderPath) {
  const prefix = folderPath === '/' ? '/' : folderPath + '/';
  const affected = Array.from(AppState.openFiles.keys()).filter(p => p === folderPath || p.startsWith(prefix));
  affected.forEach(p => forceCloseTab(p));
  if (affected.length) {
    showToast({ type: 'warning', message: `Closed ${affected.length} tab(s) inside the moved folder.` });
  }
}

async function resolveRealDirHandle(path) {
  const norm = normalizePath(path);
  if (norm === '/') return AppState.rootDirHandle;
  const parts = norm.split('/').filter(Boolean);
  let handle = AppState.rootDirHandle;
  for (const part of parts) {
    handle = await handle.getDirectoryHandle(part);
  }
  return handle;
}

async function moveFileReal(sourcePath, targetFolderPath, fileName) {
  const sourceMeta = realHandleCache.get(normalizePath(sourcePath));
  if (!sourceMeta || !sourceMeta.parentHandle) throw new Error('Could not find the real reference for the source file.');

  const targetDirHandle = await resolveRealDirHandle(targetFolderPath);

  let collision = false;
  try { await targetDirHandle.getFileHandle(fileName); collision = true; } catch { /* doesn't exist: great */ }
  if (collision) throw new Error(`a file named "${fileName}" already exists in the destination folder`);

  const file = await sourceMeta.handle.getFile();
  const content = await file.arrayBuffer();

  const newFileHandle = await targetDirHandle.getFileHandle(fileName, { create: true });
  const writable = await newFileHandle.createWritable();
  await writable.write(content);
  await writable.close();

  await sourceMeta.parentHandle.removeEntry(fileName);

  return newFileHandle;
}

function moveFileVirtual(sourcePath, targetFolderPath, fileName) {
  const node = findFileByPath(AppState.fileSystem, sourcePath);
  if (!node) throw new Error('source file not found');

  const targetFolder = findFolderByPath(AppState.fileSystem, targetFolderPath);
  if (!targetFolder) throw new Error('destination folder not found');

  if ((targetFolder.children || []).some(c => c.name === fileName)) {
    throw new Error(`a file named "${fileName}" already exists in the destination folder`);
  }

  const content = node.content ?? '';
  virtualDelete(sourcePath);
  virtualCreateFile(targetFolderPath, fileName, content);
  scheduleVirtualFsSave();
}

async function moveFolderReal(sourcePath, targetFolderPath, folderName) {
  const sourceMeta = realHandleCache.get(normalizePath(sourcePath));
  if (!sourceMeta || !sourceMeta.parentHandle) throw new Error('Could not find the real reference for the source folder.');

  const targetDirHandle = await resolveRealDirHandle(targetFolderPath);

  let collision = false;
  try { await targetDirHandle.getDirectoryHandle(folderName); collision = true; } catch { /* doesn't exist: great */ }
  if (collision) throw new Error(`a folder named "${folderName}" already exists in the destination folder`);

  return realMoveFolder(sourceMeta.parentHandle, folderName, targetDirHandle, folderName);
}

function moveFolderVirtual(sourcePath, targetFolderPath, folderName) {
  const targetFolder = findFolderByPath(AppState.fileSystem, targetFolderPath);
  if (!targetFolder) throw new Error('destination folder not found');

  if ((targetFolder.children || []).some(c => c.name === folderName)) {
    throw new Error(`a folder named "${folderName}" already exists in the destination folder`);
  }

  virtualMoveFolder(sourcePath, targetFolderPath, folderName);
  scheduleVirtualFsSave();
}

function setHovered(path, type, name) {
  hoveredPath = path; hoveredType = type; hoveredName = name;
}

function highlightActiveRow(path) {
  if (!explorerContainer) return;
  explorerContainer.querySelectorAll('.explorer-row.active').forEach(el => el.classList.remove('active'));
  const li = explorerContainer.querySelector(`li[data-path="${CSS.escape(path)}"]`);
  if (li) {
    const row = li.querySelector(':scope > .explorer-row');
    if (row) row.classList.add('active');
  }
}

export function updateExplorerModifiedIndicator(path, modified) {
  if (!explorerContainer) return;
  const li = explorerContainer.querySelector(`li[data-path="${CSS.escape(path)}"]`);
  if (!li) return;
  const label = li.querySelector(':scope > .explorer-row .explorer-label');
  if (!label) return;
  const baseName = label.textContent.replace(/^\u25CF\s/, '');
  label.textContent = modified ? `\u25CF ${baseName}` : baseName;
}

function onEntryContextMenu(e, path, type, name) {
  e.preventDefault();
  e.stopPropagation();
  setHovered(path, type, name);

  const items = [];
  if (type === 'folder') {
    items.push(
      { label: 'New File...', icon: MENU_ICONS.newFile, action: () => startCreateEntry(path, 'file') },
      { label: 'New Folder...', icon: MENU_ICONS.newFolder, action: () => startCreateEntry(path, 'folder') },
      { separator: true },
    );
  }
  items.push(
    { label: 'Rename', icon: MENU_ICONS.rename, keybinding: 'F2', action: () => startRenameEntry(path, type, name) },
    { label: 'Delete', icon: MENU_ICONS.delete, danger: true, keybinding: 'Del', action: () => deleteEntryByPath(path, type, name) },
  );

  showContextMenu(e.clientX, e.clientY, items);
}

async function ensureExpanded(path) {
  const st = folderState.get(path);
  if (st && !st.isExpanded) await st.expand();
  return st;
}

async function startCreateEntry(parentPath, type) {
  const st = await ensureExpanded(parentPath);
  if (!st) return;

  const li = document.createElement('li');
  const { row, twistyEl, iconEl } = buildRowSkeleton(st.depth);

  if (type === 'folder') twistyEl.innerHTML = '<i class="codicon codicon-chevron-right"></i>';
  iconEl.innerHTML = type === 'folder' ? getFolderIcon(false) : getFileIcon('');

  const input = document.createElement('input');
  input.className = 'explorer-inline-input';
  input.placeholder = type === 'folder' ? 'folder-name' : 'file.ext';

  row.appendChild(input);
  li.appendChild(row);
  st.ul.insertBefore(li, st.ul.firstChild);
  input.focus();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    li.remove();
    if (!name) return;

    try {
      if (st.isVirtual) {
        type === 'folder' ? virtualCreateFolder(parentPath, name) : virtualCreateFile(parentPath, name, '');
        scheduleVirtualFsSave();
      } else {
        type === 'folder' ? await realCreateFolder(st.realHandle, name) : await realCreateFile(st.realHandle, name);
      }
      showToast({ type: 'success', message: `"${name}" created successfully` });
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: `Could not create "${name}": ${err.message}` });
    }
    await renderExplorer(explorerContainer);
  };

  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); done = true; li.remove(); }
  });
  input.addEventListener('blur', () => commit());
}

export function createNewFileAtRoot() { return startCreateEntry('/', 'file'); }
export function createNewFolderAtRoot() { return startCreateEntry('/', 'folder'); }

function startRenameEntry(path, type, oldName) {
  const li = explorerContainer.querySelector(`li[data-path="${CSS.escape(path)}"]`);
  if (!li) return;
  const row = li.querySelector(':scope > .explorer-row');
  const label = row.querySelector('.explorer-label');
  if (!label) return;

  const input = document.createElement('input');
  input.className = 'explorer-inline-input';
  input.value = oldName;
  label.replaceWith(input);
  input.focus();
  input.setSelectionRange(0, oldName.lastIndexOf('.') > 0 ? oldName.lastIndexOf('.') : oldName.length);

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    if (!newName || newName === oldName) { await renderExplorer(explorerContainer); return; }
    await commitRenameEntry(path, type, oldName, newName);
  };

  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); done = true; renderExplorer(explorerContainer); }
  });
  input.addEventListener('blur', () => commit());
}

async function commitRenameEntry(path, type, oldName, newName) {
  try {
    let newPath;
    if (AppState.isRealFS) {
      const meta = realHandleCache.get(path);
      if (!meta || !meta.parentHandle) throw new Error('Could not find the real reference for this entry.');
      const newHandle = type === 'file'
        ? await realRenameFile(meta.parentHandle, oldName, newName)
        : await realRenameFolder(meta.parentHandle, oldName, newName);
      const parentPath = getParentPath(path);
      newPath = normalizePath(parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`);
      syncRenameInOpenFiles(path, newPath, newName, type, newHandle);
    } else {
      newPath = virtualRename(path, newName);
      syncRenameInOpenFiles(path, newPath, newName, type, null);
      scheduleVirtualFsSave();
    }
    showToast({
      type: 'success', message: `Renamed to "${newName}"`, timeout: 6000,
      actionLabel: 'Undo',
      onAction: () => commitRenameEntry(newPath, type, newName, oldName),
    });
  } catch (err) {
    console.error(err);
    showToast({ type: 'error', message: `Could not rename: ${err.message}` });
  }
  await renderExplorer(explorerContainer);
}

function syncRenameInOpenFiles(oldPath, newPath, newName, type, newHandle) {
  if (type === 'file') {
    if (getOpenFile(oldPath)) {
      renameOpenFile(oldPath, newPath, newName, newHandle);
    }
    return;
  }
  const prefix = oldPath === '/' ? '/' : oldPath + '/';
  const affected = Array.from(AppState.openFiles.keys()).filter(p => p === oldPath || p.startsWith(prefix));
  affected.forEach(p => forceCloseTab(p));
  if (affected.length) {
    showToast({ type: 'warning', message: `Closed ${affected.length} tab(s) inside the renamed folder.` });
  }
}

// ---------------- Undo support for delete ----------------
// Delete is the only tree operation that's truly destructive (rename
// and move are cheaply reversible by just running the same operation
// backwards). For delete, we snapshot the full content BEFORE removing
// it, so "Undo" can recreate it exactly - recursively for folders.

async function snapshotRealEntry(handle) {
  if (handle.kind === 'file') {
    const file = await handle.getFile();
    const content = await file.arrayBuffer();
    return { kind: 'file', name: handle.name, content };
  }
  const children = [];
  for await (const [, childHandle] of handle.entries()) {
    children.push(await snapshotRealEntry(childHandle));
  }
  return { kind: 'directory', name: handle.name, children };
}

async function restoreRealSnapshot(snapshot, parentHandle) {
  if (snapshot.kind === 'file') {
    const fileHandle = await parentHandle.getFileHandle(snapshot.name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(snapshot.content);
    await writable.close();
  } else {
    const dirHandle = await parentHandle.getDirectoryHandle(snapshot.name, { create: true });
    for (const child of snapshot.children) {
      await restoreRealSnapshot(child, dirHandle);
    }
  }
}

function snapshotVirtualNode(node) {
  return JSON.parse(JSON.stringify(node));
}

function restoreVirtualSnapshot(snapshot, parentPath) {
  if (snapshot.type === 'file') {
    virtualCreateFile(parentPath, snapshot.name, snapshot.content ?? '');
  } else {
    virtualCreateFolder(parentPath, snapshot.name);
    const newFolderPath = normalizePath(parentPath === '/' ? `/${snapshot.name}` : `${parentPath}/${snapshot.name}`);
    (snapshot.children || []).forEach((child) => restoreVirtualSnapshot(child, newFolderPath));
  }
  scheduleVirtualFsSave();
}

async function deleteEntryByPath(path, type, name) {
  const confirmed = await confirmDialog(
    type === 'folder' ? 'Delete Folder' : 'Delete File',
    `Are you sure you want to delete "${name}"? You'll have a few seconds to undo it right after.`,
  );
  if (!confirmed) return;

  const parentPath = getParentPath(path);
  let snapshot = null;
  let realParentHandle = null;

  try {
    if (AppState.isRealFS) {
      const meta = realHandleCache.get(path);
      if (!meta || !meta.parentHandle) throw new Error('Could not find the real reference for this entry.');
      snapshot = await snapshotRealEntry(meta.handle);
      realParentHandle = meta.parentHandle;
      await realDeleteEntry(meta.parentHandle, name, type === 'folder');
    } else {
      snapshot = snapshotVirtualNode(findFileByPath(AppState.fileSystem, path) || findFolderByPath(AppState.fileSystem, path));
      virtualDelete(path);
      scheduleVirtualFsSave();
    }

    const prefix = path === '/' ? '/' : path + '/';
    const affected = Array.from(AppState.openFiles.keys()).filter(p =>
      type === 'folder' ? (p === path || p.startsWith(prefix)) : p === path
    );
    affected.forEach(p => forceCloseTab(p));

    showToast({
      type: 'success', message: `"${name}" deleted`, timeout: 7000,
      actionLabel: 'Undo',
      onAction: async () => {
        try {
          if (AppState.isRealFS) {
            await restoreRealSnapshot(snapshot, realParentHandle);
          } else {
            restoreVirtualSnapshot(snapshot, parentPath);
          }
          showToast({ type: 'success', message: `"${name}" restored` });
        } catch (err) {
          console.error('Error undoing delete:', err);
          showToast({ type: 'error', message: `Could not restore "${name}": ${err.message}` });
        }
        await renderExplorer(explorerContainer);
      },
    });
  } catch (err) {
    console.error(err);
    showToast({ type: 'error', message: `Could not delete "${name}": ${err.message}` });
  }
  await renderExplorer(explorerContainer);
}

// File System Access API isn't available in every browser (Firefox and
// Safari don't support it as of this writing). Detecting this upfront
// lets us give a clear, actionable message instead of a cryptic
// "showDirectoryPicker is not a function" crash.
const SUPPORTS_FILE_SYSTEM_ACCESS = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickRealDirectory() {
  if (!SUPPORTS_FILE_SYSTEM_ACCESS) {
    showToast({
      type: 'error',
      title: 'Not supported in this browser',
      message: 'Opening real folders needs Chrome, Edge, or another Chromium-based browser. You can still use the virtual filesystem.',
      timeout: 7000,
    });
    return false;
  }

  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const granted = await verifyPermission(dirHandle, true);
    if (!granted) {
      showToast({ type: 'error', message: 'Read/write permission on the folder was not granted.' });
      return false;
    }

    AppState.rootDirHandle = dirHandle;
    AppState.isRealFS = true;

    // Folder history is a nice-to-have, not critical: if IndexedDB is
    // unavailable (private/incognito mode, storage disabled, etc.) the
    // folder should still open normally instead of reporting failure.
    try {
      await saveDirectoryHandle(dirHandle);
      await addRecentFolder(dirHandle);
    } catch (persistErr) {
      console.warn('Could not save folder history (IndexedDB unavailable?):', persistErr);
    }

    await renderExplorer(explorerContainer);
    showToast({ type: 'success', message: `Folder "${dirHandle.name}" opened successfully` });
    return true;
  } catch (err) {
    if (err.name === 'AbortError') return false;
    if (err.name === 'SecurityError') {
      showToast({ type: 'error', message: 'Opening folders requires a secure context (HTTPS or localhost).' });
      return false;
    }
    console.error('Error selecting folder:', err);
    showToast({ type: 'error', message: `Could not open the folder: ${err.message}` });
    return false;
  }
}

/**
 * Opens a folder from a previously granted handle (used by the recent
 * folders list). Requests permission again if needed - required after
 * a page reload even if the handle itself is still valid.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<boolean>}
 */
export async function openRecentFolder(dirHandle) {
  try {
    const granted = await verifyPermission(dirHandle, true);
    if (!granted) {
      showToast({ type: 'error', message: 'Permission on the folder was not granted.' });
      return false;
    }

    AppState.rootDirHandle = dirHandle;
    AppState.isRealFS = true;

    try {
      await saveDirectoryHandle(dirHandle);
      await addRecentFolder(dirHandle);
    } catch (persistErr) {
      console.warn('Could not update folder history (IndexedDB unavailable?):', persistErr);
    }

    await renderExplorer(explorerContainer);
    showToast({ type: 'success', message: `Folder "${dirHandle.name}" opened successfully` });
    return true;
  } catch (err) {
    console.error('Error opening recent folder:', err);
    showToast({ type: 'error', message: `Could not open the folder: ${err.message}` });
    return false;
  }
}

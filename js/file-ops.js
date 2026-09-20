// ============================================================
// file-ops.js - Pure rename/delete/create operations
// (real via File System Access API + virtual via JSON tree)
// ============================================================
import { AppState } from './state.js';
import { findFolderByPath, normalizePath, insertNode, removeNode, sortTree } from './fs-utils.js';

// ---------------- Path helpers ----------------

export function getParentPath(path) {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx <= 0 ? '/' : norm.slice(0, idx);
}

function joinPath(parentPath, name) {
  return normalizePath(parentPath === '/' ? `/${name}` : `${parentPath}/${name}`);
}

// ---------------- Real FS (File System Access API) ----------------

export async function realRenameFile(parentHandle, oldName, newName) {
  const oldFileHandle = await parentHandle.getFileHandle(oldName);
  const file = await oldFileHandle.getFile();
  const content = await file.arrayBuffer();

  const newFileHandle = await parentHandle.getFileHandle(newName, { create: true });
  const writable = await newFileHandle.createWritable();
  await writable.write(content);
  await writable.close();

  await parentHandle.removeEntry(oldName);
  return newFileHandle;
}

async function copyDirRecursive(sourceDirHandle, destDirHandle) {
  for await (const [name, handle] of sourceDirHandle.entries()) {
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      const content = await file.arrayBuffer();
      const newFileHandle = await destDirHandle.getFileHandle(name, { create: true });
      const writable = await newFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    } else {
      const newSubDir = await destDirHandle.getDirectoryHandle(name, { create: true });
      await copyDirRecursive(handle, newSubDir);
    }
  }
}

// Manual, reliable recursive delete. We don't rely on
// removeEntry(name, {recursive:true}) because in some browsers/versions
// it doesn't reliably delete the contents of non-empty folders. Instead
// we empty the folder from the inside out (deleting files and
// subfolders first), then delete the now-empty folder, which IS a
// reliably supported operation.
async function removeDirRecursive(parentHandle, name) {
  const dirHandle = await parentHandle.getDirectoryHandle(name);

  for await (const [childName, childHandle] of dirHandle.entries()) {
    if (childHandle.kind === 'directory') {
      await removeDirRecursive(dirHandle, childName);
    } else {
      await dirHandle.removeEntry(childName);
    }
  }

  await parentHandle.removeEntry(name);
}

export async function realRenameFolder(parentHandle, oldName, newName) {
  const oldDirHandle = await parentHandle.getDirectoryHandle(oldName);
  const newDirHandle = await parentHandle.getDirectoryHandle(newName, { create: true });

  await copyDirRecursive(oldDirHandle, newDirHandle);
  await removeDirRecursive(parentHandle, oldName);

  return newDirHandle;
}

/**
 * Moves a folder to a different parent directory (optionally renaming
 * it in the process). Same underlying mechanism as realRenameFolder
 * (copy the whole tree, then delete the original), just targeting a
 * different destination directory handle.
 */
export async function realMoveFolder(sourceParentHandle, folderName, targetDirHandle, newName = folderName) {
  const sourceDirHandle = await sourceParentHandle.getDirectoryHandle(folderName);
  const newDirHandle = await targetDirHandle.getDirectoryHandle(newName, { create: true });

  await copyDirRecursive(sourceDirHandle, newDirHandle);
  await removeDirRecursive(sourceParentHandle, folderName);

  return newDirHandle;
}

export async function realDeleteEntry(parentHandle, name, isFolder) {
  if (isFolder) {
    await removeDirRecursive(parentHandle, name);
  } else {
    await parentHandle.removeEntry(name);
  }
}

export async function realCreateFile(parentHandle, name) {
  return parentHandle.getFileHandle(name, { create: true });
}

export async function realCreateFolder(parentHandle, name) {
  return parentHandle.getDirectoryHandle(name, { create: true });
}

// ---------------- Virtual FS (JSON tree) ----------------

function renumberPaths(node, newPath) {
  node.path = newPath;
  if (node.type === 'folder' && Array.isArray(node.children)) {
    for (const child of node.children) {
      renumberPaths(child, joinPath(newPath, child.name));
    }
  }
}

export function virtualRename(path, newName) {
  const node = findFolderByPath(AppState.fileSystem, path) ||
    findInTree(AppState.fileSystem, path);
  if (!node) return null;
  const parentPath = getParentPath(node.path);
  const newPath = joinPath(parentPath, newName);
  node.name = newName;
  renumberPaths(node, newPath);
  sortTree(AppState.fileSystem);
  return newPath;
}

function findInTree(node, path) {
  const target = normalizePath(path);
  if (normalizePath(node.path) === target) return node;
  if (node.type === 'folder' && Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findInTree(child, target);
      if (found) return found;
    }
  }
  return null;
}

export function virtualDelete(path) {
  return removeNode(AppState.fileSystem, path);
}

/**
 * Moves a folder node (and all its descendants) to a different parent
 * folder, optionally renaming it. Reuses renumberPaths so every
 * descendant's `.path` stays correct after the move.
 */
export function virtualMoveFolder(sourcePath, targetParentPath, newName) {
  const node = findFolderByPath(AppState.fileSystem, sourcePath);
  if (!node) return null;

  removeNode(AppState.fileSystem, sourcePath);
  const newPath = joinPath(targetParentPath, newName);
  node.name = newName;
  renumberPaths(node, newPath);
  insertNode(AppState.fileSystem, targetParentPath, node);
  sortTree(AppState.fileSystem);
  return newPath;
}

export function virtualCreateFile(parentPath, name, content = '') {
  const inserted = insertNode(AppState.fileSystem, parentPath, {
    name, type: 'file', path: joinPath(parentPath, name), content,
  });
  if (inserted) sortTree(AppState.fileSystem);
  return inserted;
}

export function virtualCreateFolder(parentPath, name) {
  const inserted = insertNode(AppState.fileSystem, parentPath, {
    name, type: 'folder', path: joinPath(parentPath, name), expanded: false, children: [],
  });
  if (inserted) sortTree(AppState.fileSystem);
  return inserted;
}

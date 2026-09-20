// ============================================================
// project-io.js - Export the virtual project as a downloadable
// .zip, and import a .zip back into the virtual filesystem.
// Uses JSZip (loaded globally via a <script> tag in index.html).
// ============================================================

import { AppState } from './state.js';
import { walkTree, normalizePath, sortTree } from './fs-utils.js';
import { showToast } from './notifications.js';
import { scheduleVirtualFsSave } from './editor.js';

/**
 * Exports the current virtual file tree as a .zip and triggers a
 * browser download.
 */
export async function exportProjectAsZip() {
  if (typeof window.JSZip === 'undefined') {
    showToast({ type: 'error', message: 'JSZip did not load - check your internet connection.' });
    return;
  }

  const zip = new window.JSZip();

  walkTree(AppState.fileSystem, (node) => {
    if (node.type !== 'file') return;
    const relativePath = node.path.startsWith('/') ? node.path.slice(1) : node.path;
    if (!relativePath) return;
    zip.file(relativePath, node.content ?? '');
  });

  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast({ type: 'success', message: 'Project exported as project.zip' });
  } catch (err) {
    console.error('Error exporting project:', err);
    showToast({ type: 'error', message: `Could not export the project: ${err.message}` });
  }
}

/**
 * Opens a file picker for a .zip, then replaces the virtual
 * filesystem with its contents.
 * @returns {Promise<boolean>} true if a project was imported
 */
export function importProjectFromZip() {
  return new Promise((resolve) => {
    if (typeof window.JSZip === 'undefined') {
      showToast({ type: 'error', message: 'JSZip did not load - check your internet connection.' });
      resolve(false);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(false); return; }

      try {
        const zip = await window.JSZip.loadAsync(file);
        const newRoot = { name: 'root', type: 'folder', path: '/', expanded: true, children: [] };

        const entries = Object.values(zip.files).filter((entry) => !entry.dir);
        for (const entry of entries) {
          const content = await entry.async('string');
          insertZipEntry(newRoot, entry.name, content);
        }

        sortTree(newRoot);
        AppState.fileSystem = newRoot;
        AppState.isRealFS = false;
        AppState.rootDirHandle = null;
        scheduleVirtualFsSave();

        showToast({ type: 'success', message: `Project imported from "${file.name}"` });
        resolve(true);
      } catch (err) {
        console.error('Error importing project:', err);
        showToast({ type: 'error', message: `Could not import the .zip: ${err.message}` });
        resolve(false);
      }
    });
    input.click();
  });
}

function insertZipEntry(root, zipPath, content) {
  const parts = zipPath.split('/').filter(Boolean);
  const fileName = parts.pop();
  let current = root;
  let currentPath = '';

  for (const part of parts) {
    currentPath = normalizePath(`${currentPath}/${part}`);
    let folder = current.children.find((c) => c.type === 'folder' && c.name === part);
    if (!folder) {
      folder = { name: part, type: 'folder', path: currentPath, expanded: true, children: [] };
      current.children.push(folder);
    }
    current = folder;
  }

  if (!fileName) return;
  const filePath = normalizePath(`${currentPath}/${fileName}`);
  current.children.push({ name: fileName, type: 'file', path: filePath, content });
}

// ============================================================
// db.js - IndexedDB persistence: real folder handles, recent
// folders history, and virtual filesystem autosave.
// ============================================================

const DB_NAME = 'CodeEditorDB';
const DB_VERSION = 2;
const HANDLES_STORE = 'handles';
const RECENT_STORE = 'recentFolders';
const VIRTUAL_FS_STORE = 'virtualFS';
const ROOT_KEY = 'rootDirHandle';
const VIRTUAL_FS_KEY = 'tree';
const MAX_RECENT_FOLDERS = 8;

let dbInstance = null;

/**
 * Opens (or creates) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) {
        db.createObjectStore(HANDLES_STORE);
      }
      if (!db.objectStoreNames.contains(RECENT_STORE)) {
        db.createObjectStore(RECENT_STORE, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(VIRTUAL_FS_STORE)) {
        db.createObjectStore(VIRTUAL_FS_STORE);
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('Error opening IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

// ---------------- Legacy single-slot handle (kept for backward compatibility) ----------------

export async function saveDirectoryHandle(handle) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE, 'readwrite');
    const request = tx.objectStore(HANDLES_STORE).put(handle, ROOT_KEY);
    request.onsuccess = () => resolve(true);
    request.onerror = (event) => reject(event.target.error);
  });
}

export async function getDirectoryHandle() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE, 'readonly');
    const request = tx.objectStore(HANDLES_STORE).get(ROOT_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (event) => reject(event.target.error);
  });
}

export async function clearDirectoryHandle() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE, 'readwrite');
    const request = tx.objectStore(HANDLES_STORE).delete(ROOT_KEY);
    request.onsuccess = () => resolve(true);
    request.onerror = (event) => reject(event.target.error);
  });
}

// ---------------- Recent folders history ----------------

/**
 * Adds (or bumps to the top of) the recent folders list. Deduplicates by
 * folder name and keeps at most MAX_RECENT_FOLDERS entries.
 * @param {FileSystemDirectoryHandle} handle
 */
export async function addRecentFolder(handle) {
  const db = await openDatabase();
  const entry = { name: handle.name, handle, lastOpened: Date.now() };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_STORE, 'readwrite');
    tx.objectStore(RECENT_STORE).put(entry);
    tx.oncomplete = resolve;
    tx.onerror = (event) => reject(event.target.error);
  });

  await trimRecentFolders();
}

async function trimRecentFolders() {
  const all = await getRecentFolders();
  if (all.length <= MAX_RECENT_FOLDERS) return;

  const db = await openDatabase();
  const toRemove = all.slice(MAX_RECENT_FOLDERS);
  const tx = db.transaction(RECENT_STORE, 'readwrite');
  toRemove.forEach(entry => tx.objectStore(RECENT_STORE).delete(entry.name));
  return new Promise((resolve) => { tx.oncomplete = resolve; });
}

/**
 * Returns the recent folders list, most recently opened first.
 * @returns {Promise<Array<{name: string, handle: FileSystemDirectoryHandle, lastOpened: number}>>}
 */
export async function getRecentFolders() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_STORE, 'readonly');
    const request = tx.objectStore(RECENT_STORE).getAll();
    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => b.lastOpened - a.lastOpened);
      resolve(list);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

export async function removeRecentFolder(name) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_STORE, 'readwrite');
    tx.objectStore(RECENT_STORE).delete(name);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (event) => reject(event.target.error);
  });
}

// ---------------- Virtual filesystem autosave ----------------

/**
 * Persists the entire virtual file tree to IndexedDB. Handles/models
 * are never part of this tree (it's plain JSON), so it's always
 * structured-clone-safe.
 * @param {object} tree
 */
export async function saveVirtualFileSystem(tree) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIRTUAL_FS_STORE, 'readwrite');
    tx.objectStore(VIRTUAL_FS_STORE).put(tree, VIRTUAL_FS_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Retrieves the previously persisted virtual file tree, or null if
 * none was ever saved.
 * @returns {Promise<object|null>}
 */
export async function getVirtualFileSystem() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIRTUAL_FS_STORE, 'readonly');
    const request = tx.objectStore(VIRTUAL_FS_STORE).get(VIRTUAL_FS_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (event) => reject(event.target.error);
  });
}

export async function clearVirtualFileSystem() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIRTUAL_FS_STORE, 'readwrite');
    tx.objectStore(VIRTUAL_FS_STORE).delete(VIRTUAL_FS_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (event) => reject(event.target.error);
  });
}

// ---------------- Permissions ----------------

/**
 * Verifies (and if needed, requests) permission on a handle. This MUST
 * be called after retrieving a handle from IndexedDB, since Chrome
 * revokes the active permission on page refresh even though the
 * handle itself remains valid.
 *
 * @param {FileSystemDirectoryHandle|FileSystemFileHandle} handle
 * @param {boolean} readWrite - true to request 'readwrite' permission
 * @returns {Promise<boolean>} true if permission was granted
 */
export async function verifyPermission(handle, readWrite = true) {
  if (!handle) return false;

  const options = {};
  options.mode = readWrite ? 'readwrite' : 'read';

  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  // Requesting requires a user gesture, so this is normally called
  // from within a click handler.
  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }

  return false;
}

/**
 * Attempts to restore the previous session (legacy single-folder flow):
 * retrieves the saved handle and checks its permission state without
 * requesting it automatically (that requires a user gesture).
 *
 * @returns {Promise<{handle: FileSystemDirectoryHandle, granted: boolean}|null>}
 */
export async function restoreLastSession() {
  const handle = await getDirectoryHandle();
  if (!handle) return null;

  const options = { mode: 'readwrite' };
  const permissionState = await handle.queryPermission(options);

  return {
    handle,
    granted: permissionState === 'granted',
  };
}

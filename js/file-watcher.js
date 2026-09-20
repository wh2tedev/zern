// ============================================================
// file-watcher.js - Detects files deleted/changed externally
// (polling, since the FS Access API doesn't expose a stable
// watch mechanism in stable Chrome).
// ============================================================
import { AppState } from './state.js';

let intervalId = null;
let onFocusHandler = null;

export function startFileWatcher({ onDeleted, onExternalChange, intervalMs = 4000 }) {
  stopFileWatcher();

  const check = () => checkOpenFiles(onDeleted, onExternalChange);
  intervalId = setInterval(check, intervalMs);

  onFocusHandler = check;
  window.addEventListener('focus', onFocusHandler);
}

export function stopFileWatcher() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  if (onFocusHandler) window.removeEventListener('focus', onFocusHandler);
  onFocusHandler = null;
}

async function checkOpenFiles(onDeleted, onExternalChange) {
  for (const [path, file] of AppState.openFiles.entries()) {
    if (file.isVirtual || !file.handle) continue;

    try {
      const fsFile = await file.handle.getFile();
      const diskModTime = fsFile.lastModified;

      if (file.lastKnownModified == null) {
        file.lastKnownModified = diskModTime;
        continue;
      }

      if (diskModTime !== file.lastKnownModified) {
        const conflict = !!file.modified;
        file.lastKnownModified = diskModTime;
        onExternalChange && onExternalChange(path, file, conflict);
      }
    } catch (err) {
      if (err.name === 'NotFoundError') {
        onDeleted && onDeleted(path, file);
      }
    }
  }
}

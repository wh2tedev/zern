// ============================================================
// workspace.js - File access for extensions. Reads what the user is
// editing first (unsaved changes included), then falls back to the
// virtual tree, a GitHub repository or the real folder on disk.
// ============================================================
import { AppState } from '../state.js';
import { findFileByPath, normalizePath, walkTree } from '../fs-utils.js';
import { ensureNodeContent } from '../node-content.js';
import { getCachedHandle } from '../explorer.js';
import { openWorkspaceFile } from '../editor.js';
import { confirmDialog } from '../dialogs.js';

const enc = new TextEncoder();

export function kind() { return AppState.github ? 'github' : (AppState.isRealFS ? 'folder' : 'virtual'); }
export function activePath() { return AppState.activeFilePath; }

async function realFileHandle(path) {
  const cached = getCachedHandle(path);
  if (cached && cached.kind === 'file') return cached.handle;
  const parts = path.split('/').filter(Boolean);
  try {
    let dir = AppState.rootDirHandle;
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
    return await dir.getFileHandle(parts[parts.length - 1]);
  } catch { return null; }
}

/** @returns {Promise<{bytes: ArrayBuffer} | null>} */
export async function readBytes(path) {
  path = normalizePath(path);
  const open = AppState.openFiles.get(path);
  if (open && open.model && !open.isDiff) return { bytes: enc.encode(open.model.getValue()).buffer };
  if (AppState.isRealFS) {
    const handle = await realFileHandle(path);
    return handle ? { bytes: await (await handle.getFile()).arrayBuffer() } : null;
  }
  const node = findFileByPath(AppState.fileSystem, path);
  if (!node || node.type !== 'file') return null;
  if (!(await ensureNodeContent(node))) return null; // binary / too large in a GitHub repo
  return { bytes: enc.encode(node.content).buffer };
}

export async function readText(path) {
  const r = await readBytes(path);
  return r ? new TextDecoder().decode(r.bytes) : null;
}

// ---------------- project files ----------------
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '__pycache__', 'vendor', 'coverage', '.venv', 'venv']);

/**
 * Lists the project's files (paths like "/src/app.js"), skipping folders such as node_modules and .git.
 * @param {{ extensions?: string[], exclude?: string[], max?: number }} options extensions without dot, e.g. ['js','ts']
 */
export async function findFiles({ extensions = null, exclude = [], max = 5000 } = {}) {
  const exts = extensions && extensions.length ? new Set(extensions.map((e) => e.replace(/^\./, '').toLowerCase())) : null;
  const skip = new Set([...IGNORED_DIRS, ...exclude]);
  const wanted = (name) => !exts || exts.has((name.split('.').pop() || '').toLowerCase());
  const out = [];
  if (AppState.isRealFS && AppState.rootDirHandle) {
    const walk = async (dir, prefix) => {
      for await (const [name, handle] of dir.entries()) {
        if (out.length >= max) return;
        if (handle.kind === 'directory') { if (!skip.has(name)) await walk(handle, `${prefix}${name}/`); }
        else if (wanted(name)) out.push(prefix + name);
      }
    };
    await walk(AppState.rootDirHandle, '/');
  } else {
    walkTree(AppState.fileSystem, (node) => {
      if (node.type !== 'file' || out.length >= max || !wanted(node.name)) return;
      if (String(node.path).split('/').some((seg) => skip.has(seg))) return;
      out.push(node.path);
    });
  }
  return out.sort();
}

/** Opens a file in a tab and, optionally, puts the cursor on a line. */
export async function openFile(path, { line, column = 1 } = {}) {
  await openWorkspaceFile(path);
  const ed = AppState.editorInstance;
  if (line && ed && AppState.activeFilePath === path) {
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column });
    ed.focus();
  }
}

// ---------------- workspace trust ----------------
// Extensions that run a project's own code inside Zern (HTML Preview's full mode) ask for this first.
const TRUST_KEY = 'zern_trusted_workspaces';
const readTrusted = () => { try { return JSON.parse(localStorage.getItem(TRUST_KEY)) || []; } catch { return []; } };

/** Identifies the open workspace; null for GitHub repositories, which are never trusted. */
export function trustId() {
  if (AppState.github) return null;
  return AppState.isRealFS && AppState.rootDirHandle ? `folder:${AppState.rootDirHandle.name}` : 'virtual';
}
export function isTrusted() { const id = trustId(); return !!id && readTrusted().includes(id); }

/** Resolves to true if the workspace is (or now becomes) trusted; asks the user the first time. */
export async function requestTrust({ reason = '' } = {}) {
  const id = trustId();
  if (!id) return false;
  if (isTrusted()) return true;
  const ok = await confirmDialog(
    'Trust this project?',
    `${reason} Only trust projects you wrote or have reviewed. If you don't, it runs in a safe isolated mode instead.`,
    { okLabel: 'Trust', danger: false },
  );
  if (ok) { try { localStorage.setItem(TRUST_KEY, JSON.stringify([...new Set([...readTrusted(), id])])); } catch { /* storage blocked */ } }
  return !!ok;
}

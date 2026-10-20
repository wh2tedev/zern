// ============================================================
// github.js - GitHub repositories as a workspace.
//
// How it works (no local git, no server - only api.github.com):
//   - Opening a repo downloads its file LIST (one request). A file's
//     text is downloaded the first time you open it.
//   - The commit that was opened is the "baseline". A file is
//     Modified / Untracked / Deleted compared to that baseline.
//   - Commit & Push builds a new tree on top of the baseline with only
//     the changed files, creates the commit and moves the branch.
//   - Everything (tree + uncommitted changes) is saved in IndexedDB per
//     repository, so a reload never loses your work.
//
// Per-node fields (added to the normal virtual-tree nodes):
//   sha, mode   -> the blob this file had in the baseline commit
//   size        -> bytes (to avoid opening huge files in the editor)
//   baseContent -> baseline text, filled when the file is downloaded
//   binary      -> true when it can't be shown as text
// ============================================================

import { AppState, getOpenFile } from './state.js';
import * as api from './github-api.js';
import * as secure from './secure-token.js';
import { walkTree, findFileByPath, findFolderByPath, insertNode, removeNode, sortTree } from './fs-utils.js';
import { saveWorkspace, getWorkspace, deleteWorkspace, getVirtualFileSystem, saveVirtualFileSystem } from './db.js';
import { setNodeContentLoader } from './node-content.js';
import { showToast } from './notifications.js';
import { confirmDialog } from './dialogs.js';
import { saveFile, forceCloseTab } from './editor.js';
import { reportSaveFailure } from './safety.js';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const LAST_WORKSPACE_KEY = 'zern_last_workspace';
const RECENT_KEY = 'zern_github_recent';

// Scratch project to go back to when a repository is closed
const DEFAULT_TREE = JSON.parse(JSON.stringify(AppState.fileSystem));

// app.js plugs in the UI side of switching workspaces (close tabs, redraw explorer...)
let hooks = { beforeSwitch: async () => true, afterSwitch: async () => {} };
export function setGithubHooks(h) { hooks = { ...hooks, ...h }; }

// ---------------- Auth ----------------

export const isConnected = () => !!api.getToken();
export const getUserInfo = () => api.getCachedUser();

export async function connect(token, { remember = false, passphrase = '' } = {}) {
  const clean = (token || '').trim();
  if (!clean) throw new Error('Paste a GitHub token first.');
  if (remember && !passphrase) throw new Error('Choose a passphrase to remember the token, or untick "Remember".');
  api.setToken(clean); // memory only until GitHub accepts it
  try {
    const u = await api.getUser();
    const user = { login: u.login, name: u.name || u.login, avatar: u.avatar_url };
    api.setCachedUser(user);
    await secure.persistToken({ remember, passphrase });
    return user;
  } catch (err) {
    api.clearAuth();
    throw err;
  }
}

export function disconnect() { api.clearAuth(); }

// ---------------- Repositories ----------------

export async function listRepositories() {
  const repos = await api.listRepos();
  return repos.map((r) => ({
    fullName: r.full_name, owner: r.owner.login, name: r.name, isPrivate: r.private,
    description: r.description || '', pushedAt: r.pushed_at, defaultBranch: r.default_branch, archived: r.archived,
  }));
}

export function getRecentRepos() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function rememberRecent(fullName) {
  try {
    const list = [fullName, ...getRecentRepos().filter((n) => n !== fullName)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

export const getLastWorkspaceId = () => { try { return localStorage.getItem(LAST_WORKSPACE_KEY) || ''; } catch { return ''; } };
export function setLastWorkspaceId(id) {
  try { id ? localStorage.setItem(LAST_WORKSPACE_KEY, id) : localStorage.removeItem(LAST_WORKSPACE_KEY); } catch { /* ignore */ }
}

// ---------------- Building the workspace ----------------

function buildBaseMap(entries) {
  const base = {};
  for (const e of entries) if (e.type === 'blob') base[e.path] = { sha: e.sha, mode: e.mode };
  return base;
}

function buildTree(entries) {
  const root = { name: 'root', type: 'folder', path: '/', expanded: true, children: [] };
  const folders = new Map([['', root]]);

  const ensureFolder = (dir) => {
    if (folders.has(dir)) return folders.get(dir);
    const idx = dir.lastIndexOf('/');
    const parent = ensureFolder(idx === -1 ? '' : dir.slice(0, idx));
    const node = { name: dir.slice(idx + 1), type: 'folder', path: `/${dir}`, expanded: false, children: [] };
    parent.children.push(node);
    folders.set(dir, node);
    return node;
  };

  for (const e of entries) {
    if (e.type !== 'blob') continue; // sub-modules ("commit") are not editable here
    const idx = e.path.lastIndexOf('/');
    const parent = ensureFolder(idx === -1 ? '' : e.path.slice(0, idx));
    parent.children.push({
      name: e.path.slice(idx + 1), type: 'file', path: `/${e.path}`, sha: e.sha, mode: e.mode, size: e.size || 0,
    });
  }
  sortTree(root);
  return root;
}

async function fetchRecord(owner, repo, branch) {
  const info = await api.getRepo(owner, repo);
  const br = branch || info.default_branch;
  const head = await api.getBranchHead(owner, repo, br);
  const t = await api.getTree(owner, repo, head.tree);
  if (t.truncated) {
    showToast({ type: 'warning', message: 'This repository is very large: GitHub returned only part of the file list.', timeout: 7000 });
  }
  return {
    tree: buildTree(t.tree),
    meta: {
      id: `gh:${owner}/${repo}`, owner, repo, branch: br, defaultBranch: info.default_branch, isPrivate: info.private,
      baseCommit: head.commit, baseTree: head.tree, base: buildBaseMap(t.tree), staged: [],
    },
  };
}

async function activate(record) {
  const ok = await hooks.beforeSwitch();
  if (ok === false) return false;

  AppState.isRealFS = false;
  AppState.rootDirHandle = null;
  AppState.fileSystem = record.tree;
  AppState.github = record.meta;
  setNodeContentLoader(loadNodeContent);
  setLastWorkspaceId(record.meta.id);
  rememberRecent(`${record.meta.owner}/${record.meta.repo}`);

  await saveWorkspace(record.meta.id, record);
  setBehind(0);
  refreshNow();
  await hooks.afterSwitch();
  checkRemote({ force: true }); // is the branch already ahead of the saved copy?
  return true;
}

/**
 * Opens a repository. If this repo was opened before, its saved workspace
 * (including uncommitted changes) is restored instead of downloading again.
 */
export async function openRepository(owner, repo, { branch = null, fresh = false } = {}) {
  const id = `gh:${owner}/${repo}`;

  if (!fresh) {
    const saved = await getWorkspace(id);
    if (saved && saved.meta && (!branch || saved.meta.branch === branch)) {
      const done = await activate(saved);
      if (done) {
        const n = computeChanges().length;
        showToast({ type: 'info', message: n ? `Restored ${owner}/${repo} with ${n} uncommitted change${n === 1 ? '' : 's'}.` : `Opened ${owner}/${repo}.` });
      }
      return done;
    }
  }

  const record = await fetchRecord(owner, repo, branch);
  return activate(record);
}

/** Back to the scratch virtual project (the repository's workspace stays saved). */
export async function closeRepository() {
  const ok = await hooks.beforeSwitch();
  if (ok === false) return false;
  AppState.github = null;
  setNodeContentLoader(null);
  setLastWorkspaceId('');
  AppState.isRealFS = false;
  AppState.rootDirHandle = null;
  AppState.fileSystem = (await getVirtualFileSystem()) || JSON.parse(JSON.stringify(DEFAULT_TREE));
  setBehind(0);
  refreshNow();
  await hooks.afterSwitch();
  return true;
}

/**
 * Leaves the repository WITHOUT touching the UI (the caller already switched to something
 * else, e.g. a real folder). The scratch virtual project becomes the in-memory tree again.
 */
export async function detachRepository() {
  AppState.github = null;
  setNodeContentLoader(null);
  setLastWorkspaceId('');
  AppState.fileSystem = (await getVirtualFileSystem()) || JSON.parse(JSON.stringify(DEFAULT_TREE));
  setBehind(0);
  refreshNow();
}

/** Throws away the saved workspace and downloads the repository again. */
export async function reloadFromGitHub() {
  const gh = AppState.github;
  if (!gh) return false;
  const n = computeChanges().length;
  if (n && !(await confirmDialog('Reload from GitHub', `This discards ${n} uncommitted change${n === 1 ? '' : 's'} and downloads "${gh.owner}/${gh.repo}" again.`, { okLabel: 'Discard & reload' }))) return false;
  await deleteWorkspace(gh.id);
  return openRepository(gh.owner, gh.repo, { branch: gh.branch, fresh: true });
}

/** Writes the current project (repository or scratch) to IndexedDB right now, cancelling the pending debounced save. */
export async function flushWorkspaceNow() {
  clearTimeout(AppState.virtualFsSaveTimer);
  if (AppState.github) return persistWorkspace();
  if (!AppState.isRealFS) {
    try { await saveVirtualFileSystem(AppState.fileSystem); } catch (err) { reportSaveFailure(err); }
  }
  return undefined;
}

export function persistWorkspace() {
  const gh = AppState.github;
  if (!gh) return Promise.resolve();
  return saveWorkspace(gh.id, { tree: AppState.fileSystem, meta: gh }).catch(reportSaveFailure);
}

// ---------------- Lazy file contents ----------------

const inflight = new Map();
const baseTextCache = new Map(); // blob sha -> text (for diffs)

async function downloadText(sha) {
  const gh = AppState.github;
  let p = inflight.get(sha);
  if (!p) {
    p = api.getBlob(gh.owner, gh.repo, sha).then((b) => api.decodeBlob(b.content));
    inflight.set(sha, p);
    p.catch(() => {}).finally(() => inflight.delete(sha));
  }
  return p;
}

async function loadNodeContent(node) {
  const gh = AppState.github;
  if (!gh) return true;
  if (typeof node.content === 'string') return true;
  if (node.binary) {
    showToast({ type: 'info', message: `"${node.name}" is a binary file: it can't be opened in the editor.` });
    return false;
  }
  if (node.size > MAX_TEXT_BYTES) {
    showToast({ type: 'info', message: `"${node.name}" is larger than 2 MB: it can't be opened in the editor.` });
    return false;
  }
  try {
    const dec = await downloadText(node.sha);
    if (dec.binary) {
      node.binary = true;
      persistWorkspace();
      showToast({ type: 'info', message: `"${node.name}" is a binary file: it can't be opened in the editor.` });
      return false;
    }
    node.content = dec.text;
    node.baseContent = dec.text;
    baseTextCache.set(node.sha, dec.text);
    persistWorkspace();
    return true;
  } catch (err) {
    showToast({ type: 'error', message: `Could not download "${node.name}": ${err.message}` });
    return false;
  }
}

/** Baseline text of a file for the diff view; null when it isn't text. */
export async function getBaseText(path) {
  const gh = AppState.github;
  const b = gh && gh.base[path.slice(1)];
  if (!b) return ''; // new file: nothing before
  if (baseTextCache.has(b.sha)) return baseTextCache.get(b.sha);
  const node = findFileByPath(AppState.fileSystem, path);
  if (node && node.sha === b.sha && typeof node.baseContent === 'string') return node.baseContent;
  const dec = await downloadText(b.sha);
  if (dec.binary) return null;
  baseTextCache.set(b.sha, dec.text);
  return dec.text;
}

// ---------------- Changes ----------------
// NOTE: `gh.base` is keyed WITHOUT the leading slash (it mirrors git paths); tree nodes and
// `gh.staged` use "/path".

function isNodeChanged(node, b) {
  if (!b) return true;
  if (!node.sha) return true; // re-created locally over an existing path
  if (node.sha !== b.sha) return true;
  return typeof node.content === 'string' && typeof node.baseContent === 'string' && node.content !== node.baseContent;
}

/** @returns {Array<{path:string,status:'M'|'U'|'D',staged:boolean}>} */
export function computeChanges() {
  const gh = AppState.github;
  if (!gh) return [];
  const staged = new Set(gh.staged);
  const present = new Map();
  walkTree(AppState.fileSystem, (n) => { if (n.type === 'file') present.set(n.path, n); });

  const out = [];
  for (const [path, node] of present) {
    const b = gh.base[path.slice(1)];
    if (!b) out.push({ path, status: 'U' });
    else if (isNodeChanged(node, b)) out.push({ path, status: 'M' });
  }
  for (const rel of Object.keys(gh.base)) {
    if (!present.has(`/${rel}`)) out.push({ path: `/${rel}`, status: 'D' });
  }
  out.sort((a, b) => a.path.localeCompare(b.path, 'en', { sensitivity: 'base' }));
  out.forEach((c) => { c.staged = staged.has(c.path); });
  return out;
}

let refreshTimer = null;
export function scheduleScmRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshNow, 200);
}

export function refreshNow() {
  clearTimeout(refreshTimer);
  const gh = AppState.github;
  const changes = computeChanges();
  if (gh) { // forget staged paths that no longer have changes
    const live = new Set(changes.map((c) => c.path));
    gh.staged = gh.staged.filter((p) => live.has(p));
    changes.forEach((c) => { c.staged = gh.staged.includes(c.path); });
  }
  document.dispatchEvent(new CustomEvent('zern:scm-changed', { detail: { changes } }));
}

export function initGithub() {
  document.addEventListener('zern:workspace-changed', scheduleScmRefresh);
  if (AppState.github) setNodeContentLoader(loadNodeContent);
  startRemoteWatch();
}

// ---------------- "Behind" indicator (new commits on GitHub) ----------------
// Every ~90 s, and when you come back to the tab, the branch's head is compared with the commit
// you are based on. GitHub answers conditional requests for free (304 doesn't count against the
// rate limit), and nothing is checked while the tab is hidden or when signed out.

const POLL_MS = 90 * 1000;
const FOCUS_THROTTLE_MS = 15 * 1000;
let behind = 0;
let behindHead = null;
let lastCheck = 0;
let watchStarted = false;

export const getBehindCount = () => behind;

function setBehind(n, head = null) {
  if (n === behind && head === behindHead) return;
  behind = n;
  behindHead = n ? head : null;
  document.dispatchEvent(new CustomEvent('zern:scm-remote', { detail: { behind, head: behindHead } }));
}

/** Compares GitHub's branch head with the commit this workspace is based on. Never throws. */
export async function checkRemote({ force = false } = {}) {
  const g = AppState.github;
  if (!g || !api.getToken()) { setBehind(0); return behind; }
  if (!force && Date.now() - lastCheck < FOCUS_THROTTLE_MS) return behind;
  lastCheck = Date.now();
  try {
    const head = await api.getBranchHead(g.owner, g.repo, g.branch);
    if (AppState.github !== g) return behind; // switched repository while waiting
    if (head.commit === g.baseCommit) { setBehind(0); return 0; }
    let n = 1;
    try {
      const cmp = await api.compare(g.owner, g.repo, g.baseCommit, head.commit);
      n = cmp.status === 'behind' || cmp.status === 'identical' ? 0 : Math.max(1, cmp.ahead_by || 1);
    } catch { /* base no longer reachable (force-push): still "there is something new" */ }
    if (AppState.github === g) setBehind(n, head.commit);
  } catch { /* offline, rate limit, branch deleted...: stay quiet, try again later */ }
  return behind;
}

function startRemoteWatch() {
  if (watchStarted) return;
  watchStarted = true;
  setInterval(() => { if (document.visibilityState === 'visible') checkRemote({ force: true }); }, POLL_MS);
  window.addEventListener('focus', () => checkRemote());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkRemote(); });
}

// ---------------- Stage / unstage / discard ----------------

export function stagePaths(paths) {
  const gh = AppState.github;
  if (!gh) return;
  const set = new Set(gh.staged);
  paths.forEach((p) => set.add(p));
  gh.staged = [...set];
  persistWorkspace();
  refreshNow();
}

export function unstagePaths(paths) {
  const gh = AppState.github;
  if (!gh) return;
  const drop = new Set(paths);
  gh.staged = gh.staged.filter((p) => !drop.has(p));
  persistWorkspace();
  refreshNow();
}

function ensureFolderPath(dirPath) {
  const parts = dirPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    const next = `${current}/${part}`;
    if (!findFolderByPath(AppState.fileSystem, next)) {
      insertNode(AppState.fileSystem, current || '/', { name: part, type: 'folder', path: next, expanded: false, children: [] });
    }
    current = next;
  }
}

async function syncOpenFileFromNode(node) {
  const open = getOpenFile(node.path);
  if (!open || !open.model) return;
  if (!(await loadNodeContent(node))) return;
  open.savedContent = node.content;
  open.content = node.content;
  if (open.model.getValue() !== node.content) open.model.setValue(node.content);
}

export async function discardPaths(paths) {
  const gh = AppState.github;
  if (!gh) return;
  const byPath = new Map(computeChanges().map((c) => [c.path, c]));

  for (const path of paths) {
    const change = byPath.get(path);
    if (!change) continue;
    const b = gh.base[path.slice(1)];

    if (change.status === 'U') {
      forceCloseTab(path);
      removeNode(AppState.fileSystem, path);
    } else if (change.status === 'D') {
      const idx = path.lastIndexOf('/');
      ensureFolderPath(path.slice(0, idx) || '/');
      insertNode(AppState.fileSystem, path.slice(0, idx) || '/', {
        name: path.slice(idx + 1), type: 'file', path, sha: b.sha, mode: b.mode,
      });
    } else { // M
      const node = findFileByPath(AppState.fileSystem, path);
      if (!node) continue;
      if (node.sha !== b.sha) {
        node.sha = b.sha; node.mode = b.mode;
        delete node.content; delete node.baseContent; delete node.binary;
      } else if (typeof node.baseContent === 'string') {
        node.content = node.baseContent;
      }
      await syncOpenFileFromNode(node);
    }
  }
  sortTree(AppState.fileSystem);
  gh.staged = gh.staged.filter((p) => !paths.includes(p));
  await persistWorkspace();
  document.dispatchEvent(new CustomEvent('zern:workspace-restructured'));
  refreshNow();
}

// ---------------- Commit & push ----------------

async function refreshBaseline(treeSha, committed) {
  const gh = AppState.github;
  const full = await api.getTree(gh.owner, gh.repo, treeSha);
  gh.base = buildBaseMap(full.tree);

  const gone = new Set(committed.filter((c) => c.status === 'D').map((c) => c.path));
  walkTree(AppState.fileSystem, (n) => {
    if (n.type !== 'file') return;
    const b = gh.base[n.path.slice(1)];
    if (!b) return;
    n.sha = b.sha; n.mode = b.mode;
    if (committed.some((c) => c.path === n.path && !gone.has(c.path)) && typeof n.content === 'string') n.baseContent = n.content;
  });
}

/**
 * Commits the staged changes (or everything when nothing is staged) and moves the
 * branch on GitHub. Throws an Error with .code = 'NON_FAST_FORWARD' when the branch
 * has new commits on GitHub that must be pulled first.
 */
export async function commitAndPush(message) {
  const gh = AppState.github;
  if (!gh) throw new Error('No repository is open.');
  const msg = (message || '').trim();
  if (!msg) throw new Error('Type a commit message first.');

  const all = computeChanges();
  const selected = all.some((c) => c.staged) ? all.filter((c) => c.staged) : all;
  if (!selected.length) throw new Error('There are no changes to commit.');

  // Edits that are still waiting for autosave must be part of the commit
  for (const c of selected) {
    const open = getOpenFile(c.path);
    if (open && open.modified) await saveFile(c.path);
  }

  const entries = [];
  for (const c of selected) {
    const rel = c.path.slice(1);
    const b = gh.base[rel];
    if (c.status === 'D') { entries.push({ path: rel, mode: b.mode, type: 'blob', sha: null }); continue; }

    const node = findFileByPath(AppState.fileSystem, c.path);
    const mode = (b && b.mode) || node.mode || '100644';
    if (node.sha && (typeof node.content !== 'string' || node.content === node.baseContent)) {
      entries.push({ path: rel, mode, type: 'blob', sha: node.sha }); // untouched content (e.g. a renamed file)
    } else if (node.content === '') {
      const blob = await api.createBlob(gh.owner, gh.repo, '');
      entries.push({ path: rel, mode, type: 'blob', sha: blob.sha });
    } else {
      entries.push({ path: rel, mode, type: 'blob', content: node.content });
    }
  }

  const tree = await api.createTree(gh.owner, gh.repo, gh.baseTree, entries);
  const commit = await api.createCommit(gh.owner, gh.repo, msg, tree.sha, [gh.baseCommit]);
  try {
    await api.updateRef(gh.owner, gh.repo, gh.branch, commit.sha);
  } catch (err) {
    if (api.isNonFastForward(err)) {
      const e = new Error(`"${gh.branch}" has new commits on GitHub. Pull them first, then commit again.`);
      e.code = 'NON_FAST_FORWARD';
      throw e;
    }
    throw err;
  }

  gh.baseCommit = commit.sha;
  gh.baseTree = tree.sha;
  await refreshBaseline(tree.sha, selected);
  const done = new Set(selected.map((c) => c.path));
  gh.staged = gh.staged.filter((p) => !done.has(p));
  await persistWorkspace();
  setBehind(0);
  refreshNow();
  return { sha: commit.sha, count: selected.length, paths: selected.map((c) => c.path), url: `https://github.com/${gh.owner}/${gh.repo}/commit/${commit.sha}` };
}

// ---------------- Pull ----------------

/**
 * Brings the branch's new commits from GitHub. Files you didn't touch are updated;
 * files changed on both sides keep YOUR text and show the GitHub version as the
 * baseline, so the diff view lets you merge by hand before committing.
 */
export async function pull() {
  const gh = AppState.github;
  if (!gh) throw new Error('No repository is open.');
  const head = await api.getBranchHead(gh.owner, gh.repo, gh.branch);
  if (head.commit === gh.baseCommit) return { status: 'up-to-date' };

  const remote = await api.getTree(gh.owner, gh.repo, head.tree);
  const newBase = buildBaseMap(remote.tree);
  const nodes = new Map();
  walkTree(AppState.fileSystem, (n) => { if (n.type === 'file') nodes.set(n.path, n); });
  const sizes = new Map(remote.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.size || 0]));

  const result = { status: 'updated', updated: 0, added: 0, removed: 0, conflicts: [] };

  // Decide everything against the OLD baseline before replacing it
  const oldBase = gh.base;
  const locallyChanged = (path) => {
    const node = nodes.get(`/${path}`);
    if (!node) return false;
    const open = getOpenFile(node.path);
    return isNodeChanged(node, oldBase[path]) || !!(open && open.modified);
  };

  for (const [path, nb] of Object.entries(newBase)) {
    const ob = oldBase[path];
    const node = nodes.get(`/${path}`);
    if (ob && ob.sha === nb.sha) continue; // unchanged on GitHub

    if (!node) {
      if (!ob) { // new on GitHub
        const idx = path.lastIndexOf('/');
        ensureFolderPath(`/${path.slice(0, idx === -1 ? 0 : idx)}`);
        insertNode(AppState.fileSystem, idx === -1 ? '/' : `/${path.slice(0, idx)}`, {
          name: path.slice(idx + 1), type: 'file', path: `/${path}`, sha: nb.sha, mode: nb.mode, size: sizes.get(path),
        });
        result.added++;
      } // changed on GitHub but deleted here: stays deleted (shows as D)
      continue;
    }

    if (!locallyChanged(path)) {
      node.sha = nb.sha; node.mode = nb.mode; node.size = sizes.get(path);
      delete node.content; delete node.baseContent; delete node.binary;
      await syncOpenFileFromNode(node);
      result.updated++;
    } else {
      // Both sides changed: keep local text, make GitHub's version the baseline
      try {
        const dec = await downloadText(nb.sha);
        if (!dec.binary) node.baseContent = dec.text;
      } catch { /* the diff will fetch it again */ }
      node.sha = nb.sha; node.mode = nb.mode; node.size = sizes.get(path);
      result.conflicts.push(`/${path}`);
    }
  }

  for (const path of Object.keys(oldBase)) {
    if (newBase[path]) continue;
    const node = nodes.get(`/${path}`);
    if (!node) continue;
    if (!locallyChanged(path)) {
      forceCloseTab(node.path);
      removeNode(AppState.fileSystem, node.path);
      result.removed++;
    } // changed locally but deleted on GitHub: kept, now shows as new (U)
  }

  sortTree(AppState.fileSystem);
  gh.base = newBase;
  gh.baseCommit = head.commit;
  gh.baseTree = head.tree;
  await persistWorkspace();
  setBehind(0);
  document.dispatchEvent(new CustomEvent('zern:workspace-restructured'));
  refreshNow();
  return result;
}

// ---------------- Branches ----------------

export async function listBranchNames() {
  const gh = AppState.github;
  return (await api.listBranches(gh.owner, gh.repo)).map((b) => b.name);
}

export async function checkoutBranch(name) {
  const gh = AppState.github;
  if (!gh || name === gh.branch) return false;
  const n = computeChanges().length;
  if (n && !(await confirmDialog('Switch branch', `Switching to "${name}" discards your ${n} uncommitted change${n === 1 ? '' : 's'}. Commit them first if you want to keep them.`, { okLabel: 'Discard & switch' }))) return false;
  await deleteWorkspace(gh.id);
  return openRepository(gh.owner, gh.repo, { branch: name, fresh: true });
}

/** Creates a branch at the current commit and switches to it, keeping your changes. */
export async function createBranch(name) {
  const gh = AppState.github;
  if (!gh) throw new Error('No repository is open.');
  const clean = (name || '').trim();
  if (!clean || /\s|\.\.|[~^:?*[\\]|^\/|\/$|\.lock$/.test(clean)) throw new Error('Invalid branch name.');
  await api.createRef(gh.owner, gh.repo, clean, gh.baseCommit);
  gh.branch = clean;
  await persistWorkspace();
  setBehind(0);
  refreshNow();
  return clean;
}

export const isGithubWorkspace = () => !!AppState.github;

/**
 * Startup: if the last thing you used was a repository, put its saved workspace
 * back into AppState (no UI work here - app.js draws it). Returns true when restored.
 */
export async function restoreLastWorkspace() {
  const id = getLastWorkspaceId();
  if (!id.startsWith('gh:')) return false;
  try {
    const record = await getWorkspace(id);
    if (!record || !record.meta || !record.tree) return false;
    AppState.isRealFS = false;
    AppState.rootDirHandle = null;
    AppState.fileSystem = record.tree;
    AppState.github = record.meta;
    setNodeContentLoader(loadNodeContent);
    setTimeout(() => checkRemote({ force: true }), 1500);
    return true;
  } catch (err) {
    console.warn('Could not restore the GitHub workspace:', err);
    return false;
  }
}

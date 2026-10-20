// ============================================================
// scm-panel.js - The "Source Control" side bar view, modeled on VS Code's:
//   - sign in with a GitHub token
//   - pick a repository (any repo of your account, or type owner/name)
//   - commit box + "Staged Changes" / "Changes" lists with M / U / D
//   - click a file to see its diff; stage, unstage and discard
//   - Commit & Push, Pull, branches (also from the status bar)
// All the real work lives in github.js; this file only draws and wires it.
// ============================================================

import { AppState } from './state.js';
import * as gh from './github.js';
import * as secure from './secure-token.js';
import { GitHubError } from './github-api.js';
import { pickItem, promptText } from './quick-pick.js';
import { showToast } from './notifications.js';
import { confirmDialog } from './dialogs.js';
import { showContextMenu } from './context-menu.js';
import { getFileIcon } from './icons.js';
import { openDiffTab, closeDiffTabsFor, pruneDiffTabs, openWorkspaceFile } from './editor.js';
import { setScmDecorations } from './explorer.js';
import { escapeHtml, safeHttpUrl } from './escape.js';

let root = null;
let changes = [];
const ui = {
  view: 'main',          // 'main' | 'repos'
  message: '',
  busy: '',              // text shown while something is running ("Pushing…")
  repos: null,           // null = not loaded yet
  reposError: '',
  filter: '',
  collapsed: { staged: false, changes: false },
  connectError: '',
};

const STATUS_TEXT = { M: 'Modified', U: 'Untracked', D: 'Deleted' };

// ---------------- Small helpers ----------------

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const icon = (name) => `<i class="zi zi-${name}"></i>`;

function iconButton(name, title, onClick, extraClass = '') {
  const b = el('button', `scm-icon-btn ${extraClass}`, icon(name));
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

function relativeTime(iso) {
  if (!iso) return '';
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  const units = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [sec, label] of units) if (s >= sec) return `${Math.floor(s / sec)}${label} ago`;
  return 'just now';
}

function reportError(err, prefix = '') {
  console.error(err);
  const msg = err instanceof GitHubError || err instanceof Error ? err.message : String(err);
  showToast({ type: 'error', message: `${prefix}${msg}`, timeout: 7000 });
}

async function withBusy(text, fn) {
  if (ui.busy) return undefined;
  ui.busy = text;
  render();
  try { return await fn(); }
  finally { ui.busy = ''; render(); }
}

// ---------------- Actions ----------------

async function doConnect(token, options) {
  ui.connectError = '';
  await withBusy('Connecting…', async () => {
    try { await gh.connect(token, options); } catch (err) { ui.connectError = err.message; }
  });
  if (gh.isConnected()) { showToast({ type: 'success', message: `Connected as ${gh.getUserInfo().login}` }); await showRepoPicker(); }
}

export async function showRepoPicker() {
  if (!gh.isConnected()) { ui.view = 'main'; render(); return; }
  ui.view = 'repos';
  ui.filter = '';
  render();
  if (ui.repos === null) {
    try { ui.repos = await gh.listRepositories(); ui.reposError = ''; }
    catch (err) { ui.repos = []; ui.reposError = err.message; }
    render();
  }
}

async function openRepo(owner, name) {
  await withBusy(`Opening ${owner}/${name}…`, async () => {
    try {
      if (await gh.openRepository(owner, name)) ui.view = 'main';
    } catch (err) { reportError(err, `Could not open ${owner}/${name}: `); }
  });
}

async function doCommit() {
  if (!AppState.github) return;
  if (!ui.message.trim()) {
    showToast({ type: 'warning', message: 'Type a commit message first.' });
    const ta = root.querySelector('#scm-message');
    if (ta) ta.focus();
    return;
  }
  const branch = AppState.github.branch;
  await withBusy('Pushing…', async () => {
    try {
      const r = await gh.commitAndPush(ui.message);
      ui.message = '';
      closeDiffTabsFor(r.paths);
      showToast({
        type: 'success', timeout: 8000,
        message: `Pushed ${r.count} change${r.count === 1 ? '' : 's'} to ${branch}`,
        actionLabel: 'View on GitHub', onAction: () => { const u = safeHttpUrl(r.url); if (u) window.open(u, '_blank', 'noopener'); },
      });
    } catch (err) {
      if (err.code === 'NON_FAST_FORWARD') {
        showToast({ type: 'error', message: err.message, timeout: 12000, actionLabel: 'Pull', onAction: () => doPull() });
      } else reportError(err);
    }
  });
}

export async function doPull() {
  if (!AppState.github) return;
  await withBusy('Pulling…', async () => {
    try {
      const r = await gh.pull();
      pruneDiffTabs();
      if (r.status === 'up-to-date') { showToast({ type: 'info', message: 'Already up to date.' }); return; }
      const parts = [];
      if (r.updated) parts.push(`${r.updated} updated`);
      if (r.added) parts.push(`${r.added} added`);
      if (r.removed) parts.push(`${r.removed} removed`);
      showToast({ type: 'success', message: `Pulled from GitHub${parts.length ? `: ${parts.join(', ')}` : ''}.` });
      if (r.conflicts.length) {
        showToast({
          type: 'warning', timeout: 12000,
          message: `${r.conflicts.length} file${r.conflicts.length === 1 ? '' : 's'} changed on GitHub and here. Your version was kept: open each one in Changes to merge it before committing.`,
        });
      }
    } catch (err) { reportError(err, 'Pull failed: '); }
  });
}

export async function branchPicker() {
  const g = AppState.github;
  if (!g) return;
  let names;
  try { names = await gh.listBranchNames(); } catch (err) { reportError(err, 'Could not list branches: '); return; }
  const items = [
    { label: `+  Create new branch from "${g.branch}"…`, value: { create: true } },
    ...names.map((n) => ({ label: n, description: n === g.branch ? 'current' : '', value: { name: n } })),
  ];
  const pick = await pickItem({ placeholder: 'Select a branch or create a new one', items });
  if (!pick) return;
  if (pick.create) {
    const name = await promptText({ placeholder: 'New branch name (your changes come with you)' });
    if (!name) return;
    await withBusy('Creating branch…', async () => {
      try { await gh.createBranch(name); showToast({ type: 'success', message: `Now on new branch "${name}". Commit & Push to publish it.` }); }
      catch (err) { reportError(err, 'Could not create the branch: '); }
    });
  } else if (pick.name !== g.branch) {
    await withBusy('Switching branch…', async () => {
      try { await gh.checkoutBranch(pick.name); } catch (err) { reportError(err, 'Could not switch branch: '); }
    });
  }
}

async function openChange(change) {
  try {
    const base = await gh.getBaseText(change.path);
    if (base === null) { showToast({ type: 'info', message: 'Binary files can\'t be compared here.' }); return; }
    await openDiffTab(change.path, change.status, base);
  } catch (err) { reportError(err, 'Could not open the changes: '); }
}

async function confirmDiscard(paths) {
  const what = paths.length === 1 ? `"${paths[0].split('/').pop()}"` : `${paths.length} files`;
  const ok = await confirmDialog('Discard Changes', `Are you sure you want to discard the changes in ${what}? This is irreversible.`, { okLabel: 'Discard' });
  if (!ok) return;
  try { await gh.discardPaths(paths); closeDiffTabsFor(paths); } catch (err) { reportError(err, 'Could not discard: '); }
}

function openMoreMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const inRepo = !!AppState.github;
  const items = [];
  if (inRepo) {
    items.push(
      { label: 'Pull', action: doPull },
      { label: 'Switch Branch…', action: branchPicker },
      { separator: true },
    );
  }
  items.push({ label: 'Open Repository…', action: showRepoPicker });
  if (inRepo) {
    items.push(
      { label: 'Reload from GitHub (discard changes)', action: () => withBusy('Reloading…', () => gh.reloadFromGitHub().catch((err) => reportError(err))) },
      { label: 'Close Repository', action: () => gh.closeRepository() },
    );
  }
  if (gh.isConnected()) {
    items.push({ separator: true }, { label: `Sign Out (${(gh.getUserInfo() || {}).login || 'GitHub'})`, action: signOut });
  }
  showContextMenu(r.left, r.bottom, items);
}

export function signOut() {
  gh.disconnect();
  ui.repos = null; ui.view = 'main';
  showToast({ type: 'info', message: 'Signed out of GitHub. Your open repository stays available offline; sign in again to push.' });
  render();
}

// ---------------- Rendering ----------------

// How the token will be kept, depending on where Zern runs
function storageOptionsHtml() {
  if (secure.usesKeyring()) return '<p class="scm-hint">Saved in your system keyring.</p>';
  if (window.zernDesktop) return '<p class="scm-hint">No system keyring was found, so the token is kept for this session only.</p>';
  if (!secure.canEncrypt()) return '<p class="scm-hint">The token is kept for this session only (this page cannot encrypt it).</p>';
  return `<label class="scm-check"><input type="checkbox" id="scm-remember"> Remember on this device</label>
    <input id="scm-pass" class="scm-input" type="password" autocomplete="new-password" spellcheck="false" placeholder="Passphrase to encrypt it" hidden>
    <p class="scm-hint">By default the token is forgotten when you close the tab. If you remember it, it is encrypted with your passphrase, which you type once per session.</p>`;
}

function renderUnlock(body) {
  const box = el('div', 'scm-connect');
  box.innerHTML = `
    <div class="scm-hero">${icon('github')}</div>
    <p class="scm-lead">Your GitHub token is saved encrypted on this device. Enter your passphrase to use it.</p>
    <input id="scm-unlock-pass" class="scm-input" type="password" autocomplete="current-password" spellcheck="false" placeholder="Passphrase">
    <button type="button" class="btn-primary scm-wide" id="scm-unlock-btn">Unlock</button>
    <p class="scm-error" id="scm-unlock-error"></p>
    <button type="button" class="btn-link" id="scm-forget-btn">Forget the saved token</button>`;
  body.appendChild(box);
  const input = box.querySelector('#scm-unlock-pass');
  const go = async () => {
    try { await secure.unlockToken(input.value); ui.unlockError = ''; if (gh.isConnected()) render(); }
    catch (err) { ui.unlockError = err.message; box.querySelector('#scm-unlock-error').textContent = err.message; input.select(); }
  };
  box.querySelector('#scm-unlock-btn').addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  box.querySelector('#scm-forget-btn').addEventListener('click', async () => { await secure.clearToken(); gh.disconnect(); render(); });
  box.querySelector('#scm-unlock-error').textContent = ui.unlockError || '';
}

function renderConnect(body) {
  const box = el('div', 'scm-connect');
  box.innerHTML = `
    <div class="scm-hero">${icon('github')}</div>
    <p class="scm-lead">Connect your GitHub account to open any of your repositories, see your changes and push them.</p>
    <label class="scm-label" for="scm-token">Personal access token</label>
    <input id="scm-token" class="scm-input" type="password" autocomplete="off" spellcheck="false" placeholder="ghp_… or github_pat_…">
    ${storageOptionsHtml()}
    <button type="button" class="btn-primary scm-wide" id="scm-connect-btn">Connect</button>
    <p class="scm-error" id="scm-connect-error"></p>
    <p class="scm-hint">Create one at
      <a href="https://github.com/settings/tokens/new?scopes=repo&description=Zern" target="_blank" rel="noopener">github.com/settings/tokens</a>
      with the <b>repo</b> scope (or a fine-grained token with <b>Contents: read &amp; write</b> on the repositories you want).
      It is only ever sent to api.github.com.</p>`;
  body.appendChild(box);
  const input = box.querySelector('#scm-token');
  const remember = box.querySelector('#scm-remember'), pass = box.querySelector('#scm-pass');
  if (remember) remember.addEventListener('change', () => { pass.hidden = !remember.checked; if (remember.checked) pass.focus(); });
  const go = () => doConnect(input.value, { remember: !!(remember && remember.checked), passphrase: pass ? pass.value : '' });
  box.querySelector('#scm-connect-btn').addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  box.querySelector('#scm-connect-error').textContent = ui.connectError;
}

function renderUserRow(body) {
  const u = gh.getUserInfo() || { login: 'GitHub' };
  const row = el('div', 'scm-user');
  const avatarUrl = safeHttpUrl(u.avatar);
  const avatar = avatarUrl ? `<img class="scm-avatar" src="${escapeHtml(avatarUrl)}" alt="" width="20" height="20">` : icon('account');
  row.innerHTML = `${avatar}<span class="scm-user-name">${escapeHtml(u.login)}</span>`;
  body.appendChild(row);
}

function renderEmpty(body) {
  renderUserRow(body);
  const box = el('div', 'scm-empty');
  box.innerHTML = '<p class="scm-lead">No repository is open.</p>';
  const btn = el('button', 'btn-primary scm-wide', 'Open Repository…');
  btn.type = 'button';
  btn.addEventListener('click', showRepoPicker);
  box.appendChild(btn);

  const recents = gh.getRecentRepos();
  if (recents.length) {
    box.appendChild(el('div', 'scm-group-title', 'RECENT'));
    recents.forEach((full) => {
      const [owner, name] = full.split('/');
      const r = el('div', 'scm-repo-row', `${icon('repo')}<span class="scm-repo-name">${escapeHtml(full)}</span>`);
      r.addEventListener('click', () => openRepo(owner, name));
      box.appendChild(r);
    });
  }
  body.appendChild(box);
}

function renderRepoPicker(body) {
  const top = el('div', 'scm-picker-top');
  top.appendChild(iconButton('arrow-left', 'Back', () => { ui.view = 'main'; render(); }));
  top.appendChild(el('span', 'scm-picker-title', 'Open Repository'));
  body.appendChild(top);

  const filter = el('input', 'scm-input');
  filter.id = 'scm-repo-filter';
  filter.placeholder = 'Filter, or type owner/name';
  filter.value = ui.filter;
  filter.autocomplete = 'off';
  body.appendChild(filter);

  const list = el('div', 'scm-repo-list');
  body.appendChild(list);

  const draw = () => {
    list.innerHTML = '';
    if (ui.repos === null) { list.appendChild(el('div', 'scm-note', 'Loading your repositories…')); return; }
    if (ui.reposError) list.appendChild(el('div', 'scm-error', escapeHtml(ui.reposError)));
    const q = ui.filter.trim().toLowerCase();
    const shown = q ? ui.repos.filter((r) => `${r.fullName} ${r.description}`.toLowerCase().includes(q)) : ui.repos;

    // Any public repo can be opened by typing owner/name
    const m = ui.filter.trim().match(/^([\w.-]+)\/([\w.-]+)$/);
    if (m && !ui.repos.some((r) => r.fullName.toLowerCase() === ui.filter.trim().toLowerCase())) {
      const r = el('div', 'scm-repo-row', `${icon('cloud-download')}<span class="scm-repo-name">Open ${escapeHtml(m[1])}/${escapeHtml(m[2])}</span>`);
      r.addEventListener('click', () => openRepo(m[1], m[2]));
      list.appendChild(r);
    }
    shown.forEach((r) => {
      const row = el('div', 'scm-repo-row');
      row.innerHTML = `${icon(r.isPrivate ? 'lock' : 'repo')}
        <span class="scm-repo-main"><span class="scm-repo-name">${escapeHtml(r.fullName)}</span>${r.description ? `<span class="scm-repo-desc">${escapeHtml(r.description)}</span>` : ''}</span>
        <span class="scm-repo-time">${relativeTime(r.pushedAt)}</span>`;
      row.addEventListener('click', () => openRepo(r.owner, r.name));
      list.appendChild(row);
    });
    if (!shown.length && !m) list.appendChild(el('div', 'scm-note', 'No repositories match.'));
  };
  filter.addEventListener('input', () => { ui.filter = filter.value; draw(); });
  draw();
  setTimeout(() => filter.focus(), 0);
}

function fileRow(change, staged) {
  const name = change.path.split('/').pop();
  const dir = change.path.slice(1, change.path.length - name.length - 1);
  const row = el('div', 'scm-row');
  row.dataset.path = change.path;
  row.title = `${change.path.slice(1)} — ${STATUS_TEXT[change.status]}`;
  row.innerHTML = `<span class="scm-file-icon">${getFileIcon(name)}</span>
    <span class="scm-name${change.status === 'D' ? ' deleted' : ''}">${escapeHtml(name)}</span>
    <span class="scm-dir">${escapeHtml(dir)}</span>`;

  const actions = el('span', 'scm-row-actions');
  if (change.status !== 'D') actions.appendChild(iconButton('go-to-file', 'Open File', () => openWorkspaceFile(change.path)));
  if (!staged) {
    actions.appendChild(iconButton('discard', 'Discard Changes', () => confirmDiscard([change.path])));
    actions.appendChild(iconButton('add', 'Stage Changes', () => gh.stagePaths([change.path])));
  } else {
    actions.appendChild(iconButton('remove', 'Unstage Changes', () => gh.unstagePaths([change.path])));
  }
  row.appendChild(actions);
  row.appendChild(el('span', `scm-status scm-status-${change.status}`, change.status));

  row.addEventListener('click', () => openChange(change));
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Open Changes', action: () => openChange(change) },
      { label: 'Open File', disabled: change.status === 'D', action: () => openWorkspaceFile(change.path) },
      { separator: true },
      staged
        ? { label: 'Unstage Changes', action: () => gh.unstagePaths([change.path]) }
        : { label: 'Stage Changes', action: () => gh.stagePaths([change.path]) },
      { label: 'Discard Changes', disabled: staged, danger: true, action: () => confirmDiscard([change.path]) },
    ]);
  });
  return row;
}

function group(key, title, list, staged) {
  const wrap = el('div', 'scm-group');
  const head = el('div', 'scm-group-header');
  head.innerHTML = `<span class="scm-chevron">${icon(ui.collapsed[key] ? 'chevron-right' : 'chevron-down')}</span><span class="scm-group-name">${title}</span>`;
  const actions = el('span', 'scm-row-actions');
  const paths = list.map((c) => c.path);
  if (!staged) {
    actions.appendChild(iconButton('discard', 'Discard All Changes', () => confirmDiscard(paths)));
    actions.appendChild(iconButton('add', 'Stage All Changes', () => gh.stagePaths(paths)));
  } else {
    actions.appendChild(iconButton('remove', 'Unstage All Changes', () => gh.unstagePaths(paths)));
  }
  head.appendChild(actions);
  head.appendChild(el('span', 'scm-count', String(list.length)));
  head.addEventListener('click', () => { ui.collapsed[key] = !ui.collapsed[key]; render(); });
  wrap.appendChild(head);
  if (!ui.collapsed[key]) list.forEach((c) => wrap.appendChild(fileRow(c, staged)));
  return wrap;
}

function renderRepo(body) {
  const g = AppState.github;
  const bar = el('div', 'scm-repo-bar');
  bar.innerHTML = `${icon(g.isPrivate ? 'lock' : 'repo')}<span class="scm-repo-title" title="${escapeHtml(g.owner + '/' + g.repo)}">${escapeHtml(g.owner)}/${escapeHtml(g.repo)}</span>`;
  const branch = el('button', 'scm-branch-btn', `${icon('git-branch')}<span>${escapeHtml(g.branch)}</span>`);
  branch.type = 'button';
  branch.title = 'Switch or create branch';
  branch.addEventListener('click', branchPicker);
  bar.appendChild(branch);
  body.appendChild(bar);

  const behindN = Number(gh.getBehindCount()) || 0;
  if (behindN) {
    const note = el('div', 'scm-behind', `${icon('arrow-down')}<span>${behindN} new commit${behindN === 1 ? '' : 's'} on GitHub</span>`);
    const pullBtn = el('button', 'scm-behind-btn', 'Pull');
    pullBtn.type = 'button';
    pullBtn.addEventListener('click', () => doPull());
    note.appendChild(pullBtn);
    body.appendChild(note);
  }

  const staged = changes.filter((c) => c.staged);
  const unstaged = changes.filter((c) => !c.staged);
  const total = changes.length;

  const commit = el('div', 'scm-commit');
  const ta = el('textarea', 'scm-message');
  ta.id = 'scm-message';
  ta.rows = 3;
  ta.placeholder = `Message (Ctrl+Enter to commit & push on "${g.branch}")`;
  ta.value = ui.message;
  ta.addEventListener('input', () => { ui.message = ta.value; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCommit(); } });
  commit.appendChild(ta);

  const btn = el('button', 'btn-primary scm-wide scm-commit-btn', `${icon('check')} Commit &amp; Push`);
  btn.type = 'button';
  btn.disabled = !total || !!ui.busy;
  btn.title = staged.length ? `Commit ${staged.length} staged change(s) and push to ${g.branch}` : `Commit all ${total} change(s) and push to ${g.branch}`;
  btn.addEventListener('click', doCommit);
  commit.appendChild(btn);
  body.appendChild(commit);

  if (!total) {
    body.appendChild(el('div', 'scm-note', 'No changes. Edits you save will show up here.'));
    return;
  }
  if (staged.length) body.appendChild(group('staged', 'Staged Changes', staged, true));
  if (unstaged.length) body.appendChild(group('changes', 'Changes', unstaged, false));
}

function render() {
  if (!root) return;
  const active = document.activeElement;
  const focusId = active && root.contains(active) ? active.id : '';
  const selStart = focusId && active.selectionStart != null ? active.selectionStart : null;
  const scrollTop = root.scrollTop;

  root.innerHTML = '';
  const body = el('div', 'scm-body');
  root.appendChild(body);

  if (secure.isLocked()) renderUnlock(body);
  else if (!gh.isConnected() && !AppState.github) renderConnect(body);
  else if (ui.view === 'repos') renderRepoPicker(body);
  else if (!AppState.github) renderEmpty(body);
  else { if (!gh.isConnected()) body.appendChild(el('div', 'scm-note', 'Signed out: you can keep editing offline, but you need to sign in again to push.')); renderRepo(body); }

  if (ui.busy) {
    const veil = el('div', 'scm-busy', `<span class="scm-spinner"></span>${escapeHtml(ui.busy)}`);
    body.appendChild(veil);
  }

  root.scrollTop = scrollTop;
  if (focusId) {
    const again = root.querySelector(`#${focusId}`);
    if (again) { again.focus(); if (selStart != null && again.setSelectionRange) again.setSelectionRange(selStart, selStart); }
  }
}

// ---------------- Wiring ----------------

export function getChangeCount() { return changes.length; }

export function initScmPanel(container) {
  root = container;
  document.addEventListener('zern:scm-changed', (e) => {
    changes = e.detail.changes;
    setScmDecorations(changes);
    render();
  });
  // GitHub has commits we don't: redraw the banner and tell you once per new head
  let notifiedHead = null;
  document.addEventListener('zern:scm-remote', (e) => {
    const { behind, head } = e.detail;
    render();
    if (behind && head && head !== notifiedHead && AppState.github) {
      notifiedHead = head;
      showToast({
        type: 'info', timeout: 10000,
        message: `${behind} new commit${behind === 1 ? '' : 's'} on GitHub in "${AppState.github.branch}".`,
        actionLabel: 'Pull', onAction: () => doPull(),
      });
    }
  });

  // Workspace switched / signed in or out elsewhere
  document.addEventListener('zern:workspace-switched', () => { ui.view = 'main'; render(); });
  render();

  // Header buttons of the view
  const hdr = document.getElementById('scm-header-actions');
  if (hdr) {
    hdr.innerHTML = '';
    hdr.appendChild(iconButton('repo-pull', 'Pull', () => doPull()));
    hdr.appendChild(iconButton('refresh', 'Refresh', () => gh.refreshNow()));
    hdr.appendChild(iconButton('ellipsis', 'More Actions…', openMoreMenu));
  }
}

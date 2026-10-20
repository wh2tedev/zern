// ============================================================
// github-api.js - Minimal GitHub REST client (browser, fetch only).
// api.github.com supports CORS, so no server is needed. The token
// lives in the OS keyring (desktop) or the session / an encrypted copy (web), see secure-token.js, and is only ever sent to
// api.github.com.
// ============================================================

import * as secure from './secure-token.js';

const API = 'https://api.github.com';
const USER_KEY = 'zern_github_user';

export class GitHubError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.data = data;
  }
}

// ---------------- Token / user ----------------

export function getToken() { return secure.getTokenSync(); }
export function setToken(token) { secure.setTokenInMemory(token); } // memory only; connect() persists it once verified
export function getCachedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function setCachedUser(user) {
  try { user ? localStorage.setItem(USER_KEY, JSON.stringify(user)) : localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}
export function clearAuth() {
  secure.clearToken();
  try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}

// ---------------- Core request ----------------

function friendlyMessage(status, data, res) {
  const apiMsg = data && data.message ? String(data.message) : '';
  if (status === 401) return 'GitHub rejected the token (invalid, expired or revoked).';
  if (status === 403 && res && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const when = reset ? ` Try again at ${new Date(reset).toLocaleTimeString()}.` : '';
    return `GitHub API rate limit reached.${when}`;
  }
  if (status === 403) return apiMsg || 'The token does not have permission for this action.';
  if (status === 404) return 'Not found. Check that the token has access to this repository.';
  return apiMsg || `GitHub request failed (${status}).`;
}

async function request(path, { method = 'GET', body } = {}) {
  const token = getToken();
  if (!token) throw new GitHubError('Not connected to GitHub.', 401);

  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path.startsWith('http') ? path : API + path, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new GitHubError('Could not reach GitHub. Check your internet connection.', 0, err);
  }

  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    throw new GitHubError(friendlyMessage(res.status, data, res), res.status, data);
  }
  return res.status === 204 ? null : res.json();
}

async function paginate(path, { perPage = 100, maxPages = 10 } = {}) {
  const out = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= maxPages; page++) {
    const chunk = await request(`${path}${sep}per_page=${perPage}&page=${page}`);
    out.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return out;
}

const seg = (s) => s.split('/').map(encodeURIComponent).join('/'); // keeps "feature/x" branch names intact

// ---------------- Endpoints ----------------

export const getUser = () => request('/user');

export const listRepos = () =>
  paginate('/user/repos?sort=pushed&affiliation=owner,collaborator,organization_member');

export const getRepo = (owner, repo) => request(`/repos/${owner}/${repo}`);

/** @returns {{commit: string, tree: string}} head commit + root tree of a branch */
export async function getBranchHead(owner, repo, branch) {
  const b = await request(`/repos/${owner}/${repo}/branches/${seg(branch)}`);
  return { commit: b.commit.sha, tree: b.commit.commit.tree.sha };
}

/** How far `head` is ahead of `base` (per_page=1: we only need the counters, not the commit list). */
export const compare = (owner, repo, base, head) =>
  request(`/repos/${owner}/${repo}/compare/${base}...${head}?per_page=1`);

export const listBranches = (owner, repo) => paginate(`/repos/${owner}/${repo}/branches`);

export const getTree = (owner, repo, sha) => request(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);

export const getBlob = (owner, repo, sha) => request(`/repos/${owner}/${repo}/git/blobs/${sha}`);

export const createBlob = (owner, repo, content) =>
  request(`/repos/${owner}/${repo}/git/blobs`, { method: 'POST', body: { content, encoding: 'utf-8' } });

export const createTree = (owner, repo, baseTree, tree) =>
  request(`/repos/${owner}/${repo}/git/trees`, { method: 'POST', body: { base_tree: baseTree, tree } });

export const createCommit = (owner, repo, message, tree, parents) =>
  request(`/repos/${owner}/${repo}/git/commits`, { method: 'POST', body: { message, tree, parents } });

export const updateRef = (owner, repo, branch, sha) =>
  request(`/repos/${owner}/${repo}/git/refs/heads/${seg(branch)}`, { method: 'PATCH', body: { sha, force: false } });

export const createRef = (owner, repo, branch, sha) =>
  request(`/repos/${owner}/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } });

export const isNonFastForward = (err) =>
  err instanceof GitHubError && (err.status === 422 || err.status === 409) && /fast.?forward/i.test((err.data && err.data.message) || err.message);

// ---------------- Blob decoding ----------------

/**
 * Decodes a blob from the API (base64). Returns {text} for UTF-8 text or
 * {binary: true} for anything else (NUL bytes / invalid UTF-8).
 */
export function decodeBlob(base64) {
  const bin = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const probe = Math.min(bytes.length, 8000);
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) return { binary: true };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { binary: true };
  }
}

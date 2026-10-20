// ============================================================
// secure-token.js - Where the GitHub token lives.
//
//  Desktop app   OS keyring (Electron safeStorage). Never in localStorage.
//  Web           Only in this tab's session by default (sessionStorage).
//                Optionally remembered on this device, encrypted with a
//                passphrase you type once per session (PBKDF2 + AES-GCM).
//
// The token is kept in memory while Zern runs; getToken() stays
// synchronous for the rest of the app. A token saved in plain text by an
// older version is moved here and removed from localStorage.
// ============================================================
const LEGACY_KEY = 'zern_github_token';          // plain text (versions before rc.10)
const SESSION_KEY = 'zern_github_token_session';
const ENCRYPTED_KEY = 'zern_github_token_enc';
const ITERATIONS = 210000;

const desktop = () => (window.zernDesktop && window.zernDesktop.secrets) || null;

let token = '';
let locked = false;          // an encrypted token exists but has not been unlocked in this session
let keyring = false;         // desktop only: the OS keyring can be used
let migration = null;        // 'keyring' | 'session' once, so the UI can tell the user

export const getTokenSync = () => token;
export const isLocked = () => locked;
export const usesKeyring = () => keyring;
export const takeMigrationNotice = () => { const m = migration; migration = null; return m; };
export const canEncrypt = () => !keyring && !!(window.crypto && window.crypto.subtle);
export const hasEncryptedToken = () => { try { return !!localStorage.getItem(ENCRYPTED_KEY); } catch { return false; } };

// ---------------- crypto ----------------
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(plain, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(passphrase, salt), new TextEncoder().encode(plain));
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) });
}
async function decrypt(blob, passphrase) {
  const o = JSON.parse(blob);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, await deriveKey(passphrase, unb64(o.salt)), unb64(o.data));
  return new TextDecoder().decode(plain);
}

// ---------------- lifecycle ----------------
/** Call once at startup, before anything reads the token. */
export async function initSecureToken() {
  let legacy = '';
  try { legacy = localStorage.getItem(LEGACY_KEY) || ''; } catch { /* storage blocked */ }
  const d = desktop();

  if (d) {
    try { keyring = !!(await d.status()).available; } catch { keyring = false; }
    if (keyring) {
      token = (await d.get('github_token')) || '';
      if (!token && legacy) { token = legacy; await d.set('github_token', legacy); migration = 'keyring'; }
    }
  }
  if (!token) { try { token = sessionStorage.getItem(SESSION_KEY) || ''; } catch { /* ignore */ } }
  if (!token && legacy) { // no keyring (web, or desktop without one): keep it for this session only
    token = legacy;
    try { sessionStorage.setItem(SESSION_KEY, legacy); } catch { /* ignore */ }
    migration = 'session';
  }
  if (legacy) { try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ } }
  locked = !token && hasEncryptedToken();
}

/** Puts the token in memory only (used while it is being verified). */
export function setTokenInMemory(value) { token = value || ''; locked = false; }

/** Persists the verified token. Returns where it went: 'keyring' | 'passphrase' | 'session'. */
export async function persistToken({ remember = false, passphrase = '' } = {}) {
  if (!token) return 'session';
  const d = desktop();
  if (d && keyring) { await d.set('github_token', token); return 'keyring'; }
  try { sessionStorage.setItem(SESSION_KEY, token); } catch { /* ignore */ }
  if (remember && passphrase && canEncrypt()) {
    try { localStorage.setItem(ENCRYPTED_KEY, await encrypt(token, passphrase)); return 'passphrase'; } catch { /* fall through to session */ }
  }
  return 'session';
}

/** Decrypts the remembered token with the passphrase; throws if it is wrong. */
export async function unlockToken(passphrase) {
  const blob = localStorage.getItem(ENCRYPTED_KEY);
  if (!blob) throw new Error('There is no saved token.');
  try { token = await decrypt(blob, passphrase); }
  catch { throw new Error('Wrong passphrase.'); }
  locked = false;
  try { sessionStorage.setItem(SESSION_KEY, token); } catch { /* ignore */ }
}

export async function clearToken() {
  token = ''; locked = false;
  try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(ENCRYPTED_KEY); localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  const d = desktop();
  if (d) { try { await d.delete('github_token'); } catch { /* ignore */ } }
}

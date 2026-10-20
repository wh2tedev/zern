'use strict';
// How the GitHub token is protected on the web: session only, or AES-GCM with a passphrase. (The desktop keyring is Electron's job.)
const test = require('node:test');
const assert = require('node:assert');
const { load, installBrowserFakes } = require('./helpers/esm');

const TOKEN = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let st;
test.before(async () => { installBrowserFakes(); st = await load('js/secure-token.js'); });
test.beforeEach(() => { localStorage.clear(); sessionStorage.clear(); delete window.zernDesktop; st.setTokenInMemory(''); st.takeMigrationNotice(); });

test('remembering a token stores it encrypted: the plain text is nowhere in storage', async () => {
  st.setTokenInMemory(TOKEN);
  assert.strictEqual(await st.persistToken({ remember: true, passphrase: 'correct horse' }), 'passphrase');
  const blob = localStorage.getItem('zern_github_token_enc');
  assert.ok(blob);
  assert.ok(!blob.includes(TOKEN));
  assert.ok(!blob.includes(Buffer.from(TOKEN).toString('base64')));
  assert.strictEqual(localStorage.getItem('zern_github_token'), null); // never the old plain-text key
  const o = JSON.parse(blob);
  assert.deepStrictEqual(Object.keys(o).sort(), ['data', 'iv', 'salt', 'v']);
});

test('the right passphrase unlocks it, a wrong one does not', async () => {
  st.setTokenInMemory(TOKEN);
  await st.persistToken({ remember: true, passphrase: 'correct horse' });
  st.setTokenInMemory(''); // a new session: nothing in memory
  await assert.rejects(st.unlockToken('wrong'), /Wrong passphrase/);
  assert.strictEqual(st.getTokenSync(), '');
  await st.unlockToken('correct horse');
  assert.strictEqual(st.getTokenSync(), TOKEN);
});

test('every encryption is different (fresh salt and IV)', async () => {
  st.setTokenInMemory(TOKEN);
  await st.persistToken({ remember: true, passphrase: 'pw' });
  const a = localStorage.getItem('zern_github_token_enc');
  await st.persistToken({ remember: true, passphrase: 'pw' });
  assert.notStrictEqual(a, localStorage.getItem('zern_github_token_enc'));
});

test('without "remember" only the session holds it', async () => {
  st.setTokenInMemory(TOKEN);
  assert.strictEqual(await st.persistToken({ remember: false }), 'session');
  assert.strictEqual(sessionStorage.getItem('zern_github_token_session'), TOKEN);
  assert.strictEqual(localStorage.getItem('zern_github_token_enc'), null);
});

test('a token saved in plain text by an older version is moved out of localStorage', async () => {
  localStorage.setItem('zern_github_token', TOKEN);
  await st.initSecureToken();
  assert.strictEqual(localStorage.getItem('zern_github_token'), null);
  assert.strictEqual(st.getTokenSync(), TOKEN);
  assert.strictEqual(st.takeMigrationNotice(), 'session');
  assert.strictEqual(st.takeMigrationNotice(), null); // only told once
});

test('start-up with an encrypted token and no session asks for the passphrase', async () => {
  st.setTokenInMemory(TOKEN);
  await st.persistToken({ remember: true, passphrase: 'pw' });
  sessionStorage.clear();
  st.setTokenInMemory('');
  await st.initSecureToken();
  assert.ok(st.isLocked());
  assert.strictEqual(st.getTokenSync(), '');
});

test('clearToken forgets everything', async () => {
  st.setTokenInMemory(TOKEN);
  await st.persistToken({ remember: true, passphrase: 'pw' });
  await st.clearToken();
  assert.strictEqual(st.getTokenSync(), '');
  assert.strictEqual(localStorage.getItem('zern_github_token_enc'), null);
  assert.strictEqual(sessionStorage.getItem('zern_github_token_session'), null);
});

test('with the desktop keyring the token goes there and not to web storage', async () => {
  const kept = {};
  window.zernDesktop = { secrets: { status: async () => ({ available: true }), get: async (k) => kept[k] || null, set: async (k, v) => { kept[k] = v; return true; }, delete: async (k) => { delete kept[k]; return true; } } };
  await st.initSecureToken();
  assert.ok(st.usesKeyring());
  st.setTokenInMemory(TOKEN);
  assert.strictEqual(await st.persistToken({ remember: true, passphrase: 'pw' }), 'keyring');
  assert.strictEqual(kept.github_token, TOKEN);
  assert.strictEqual(sessionStorage.getItem('zern_github_token_session'), null);
  assert.strictEqual(localStorage.getItem('zern_github_token_enc'), null);
  await st.clearToken();
  assert.strictEqual(kept.github_token, undefined);
});

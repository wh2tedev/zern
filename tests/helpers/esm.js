'use strict';
// Loads one of Zern's browser modules (ES modules under js/ and extensions/) from CommonJS tests.
// Browser globals that some modules touch are provided as small fakes.
const path = require('path');
const { pathToFileURL } = require('url');
const { ROOT } = require('./source-files');

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

function installBrowserFakes() {
  if (!globalThis.localStorage) globalThis.localStorage = memoryStorage();
  if (!globalThis.sessionStorage) globalThis.sessionStorage = memoryStorage();
  if (!globalThis.window) globalThis.window = globalThis;
  if (!globalThis.document) globalThis.document = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, getElementById: () => null, querySelector: () => null };
}

async function load(relPath) {
  installBrowserFakes();
  return import(pathToFileURL(path.join(ROOT, relPath)).href);
}

module.exports = { load, memoryStorage, installBrowserFakes };

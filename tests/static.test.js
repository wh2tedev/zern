'use strict';
// Consistency checks across files: the things that went wrong by hand in earlier releases.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, appSources, rel, read } = require('./helpers/source-files');

const exists = (p) => fs.existsSync(path.join(ROOT, p));
const pkg = JSON.parse(read('package.json'));

test('one version everywhere', () => {
  const v = pkg.version;
  assert.strictEqual(JSON.parse(read('package-lock.json')).version, v, 'package-lock.json');
  assert.ok(read('js/version.js').includes(`'${v}'`), 'js/version.js');
  assert.ok(read('sw.js').includes(`zern-cache-v${v}`), 'sw.js CACHE_NAME');
  assert.ok(read('index.html').includes(`name="zern-version" content="${v}"`), 'index.html meta');
  assert.ok(new RegExp(`^## ${v.replace(/\./g, '\\.')}\\b`, 'm').test(read('CHANGELOG.md')), 'CHANGELOG.md has no entry for this version');
});

test('the offline shell lists real files and covers every module and stylesheet', () => {
  const sw = read('sw.js');
  const shell = [...sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  const missing = shell.filter((f) => !exists(f));
  assert.deepStrictEqual(missing, [], 'listed in sw.js but not on disk');
  const need = new Set();
  for (const m of read('index.html').matchAll(/(?:href|src)="((?:css|js)\/[^"]+)"/g)) need.add(m[1]);
  // every module reachable from js/app.js
  const queue = ['js/app.js'], seen = new Set();
  while (queue.length) {
    const f = queue.pop(); if (seen.has(f)) continue; seen.add(f); need.add(f);
    for (const m of read(f).matchAll(/from '(\.[^']+)'/g)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
  }
  const notCached = [...need].filter((f) => !shell.includes(f));
  assert.deepStrictEqual(notCached, [], 'needed by the page but missing from APP_SHELL in sw.js (offline would break)');
});

test('manifest icons exist', () => {
  for (const i of JSON.parse(read('manifest.json')).icons) assert.ok(exists(i.src), i.src);
});

test('every icon the app uses has a glyph in css/icons.css', () => {
  const defined = new Set([...read('css/icons.css').matchAll(/\.zi-([a-z0-9-]+)/g)].map((m) => m[1]));
  const used = new Map();
  const files = [...appSources().map(rel), 'index.html'];
  for (const f of files) for (const m of read(f).matchAll(/\bzi-([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w$-]|\$\{)/g)) used.set(m[1], f);
  for (const f of files) for (const m of read(f).matchAll(/\$\(([a-z0-9-]+)\)/g)) used.set(m[1], f);
  const absent = [...used].filter(([n]) => !defined.has(n) && n !== 'modifier-spin').map(([n, f]) => `${n} (${f})`);
  assert.deepStrictEqual(absent, []);
});

test('extension catalog is up to date', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-catalog.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('extensions are well formed', () => {
  const { extensions } = JSON.parse(read('extensions/registry.json'));
  const ids = new Set();
  for (const { dir } of extensions) {
    const m = JSON.parse(read(`extensions/${dir}/zern-extension.json`));
    assert.match(m.version, /^\d+\.\d+\.\d+$/, dir);
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`); ids.add(m.id);
    for (const k of ['main', 'readme', 'changelog', 'icon']) assert.ok(exists(`extensions/${dir}/${m[k]}`), `${dir}: ${k}`);
    assert.ok(new RegExp(`^## ${m.version.replace(/\./g, '\\.')}\\b`, 'm').test(read(`extensions/${dir}/CHANGELOG.md`)), `${dir}: CHANGELOG lacks ${m.version}`);
  }
});

test('the only servers Zern can contact are the documented ones (keeps the Privacy text true)', () => {
  const ALLOWED = new Set(['api.github.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
  const documentation = /^(github\.com|creativecommons\.org|openfontlicense\.org|www\.w3\.org|x|localhost|img\.shields\.io|example\.com|www\.nordtheme\.com)$/; // links, XML namespaces, examples
  const found = new Map();
  for (const f of [...appSources().map(rel), 'index.html', 'main.js', 'sw.js', ...fs.readdirSync(path.join(ROOT, 'css')).filter((x) => x !== 'icons.css').map((x) => `css/${x}`)]) {
    for (const m of read(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) if (!documentation.test(m[1])) found.set(m[1], f);
  }
  const unexpected = [...found].filter(([h]) => !ALLOWED.has(h)).map(([h, f]) => `${h} (${f})`);
  assert.deepStrictEqual(unexpected, [], 'new external host: update the Privacy text and this list together');
});

test('third-party notices name everything that ships', () => {
  const n = read('THIRD_PARTY_NOTICES.txt');
  for (const name of ['Monaco', 'Codicons', 'JSZip', 'Electron', 'Chromium', 'Inter', 'JetBrains Mono', 'Lora', 'TypeScript', 'Nord']) assert.ok(n.includes(name), `THIRD_PARTY_NOTICES.txt does not mention ${name}`);
});

test('the desktop build ships every root file main.js needs', () => {
  const files = pkg.build.files;
  for (const m of read('main.js').matchAll(/require\('\.\/([\w-]+)'\)/g)) assert.ok(files.includes(`${m[1]}.js`), `${m[1]}.js is required by main.js but not in build.files`);
});

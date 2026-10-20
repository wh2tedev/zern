'use strict';
// The welcome page must stay truthful: its numbers, names and links come from the project itself.
const test = require('node:test');
const assert = require('node:assert');
const { read } = require('./helpers/source-files');

const html = read('index.html');
const landing = html.slice(html.indexOf('<div id="landing"'), html.indexOf('<script src="js/boot.js">'));
const pkg = JSON.parse(read('package.json'));

test('shows the current version', () => {
  assert.ok(landing.includes(`Version ${pkg.version}`), `landing should say "Version ${pkg.version}"`);
});

test('lists every extension in the registry, by its real name', () => {
  const { extensions } = JSON.parse(read('extensions/registry.json'));
  assert.ok(extensions.length >= 1);
  for (const { dir } of extensions) {
    const m = JSON.parse(read(`extensions/${dir}/zern-extension.json`));
    assert.ok(landing.includes(`<b>${m.displayName}</b>`), `landing does not list ${m.displayName}`);
  }
  assert.ok(landing.includes(`${extensions.length === 7 ? 'Seven' : ''}`), 'the "Seven extensions" headline is stale');
  assert.strictEqual((landing.match(/<ul class="l-ext">[\s\S]*?<\/ul>/)[0].match(/<li>/g) || []).length, extensions.length);
});

test('download, web and GitHub links are the official ones', () => {
  assert.ok(landing.includes('href="https://github.com/wh2tedev/zern/releases/latest"'));
  assert.ok(landing.includes('href="https://github.com/wh2tedev/zern"'));
  assert.ok(landing.includes('href="https://github.com/wh2tedev"')); // founder
  assert.ok(landing.includes('Download for Linux (.deb)'));
  assert.ok(landing.includes('>Try on web<'));
  // "Open Zern" exists only for the desktop app, where there is nothing to download or "try"
  for (const m of landing.matchAll(/<button[^>]*>Open Zern<\/button>/g)) assert.ok(m[0].includes('l-desk-only'), m[0]);
});

test('every link that opens a new tab is noopener', () => {
  for (const m of landing.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) assert.ok(/rel="noopener noreferrer"/.test(m[0]), m[0]);
});

test('footer: legal links open panels that exist, plus copyright and third-party credits', () => {
  for (const kind of ['terms', 'privacy', 'licenses']) {
    assert.ok(landing.includes(`data-legal="${kind}"`), kind);
    assert.ok(landing.includes(`<template id="l-tpl-${kind}"`), `missing template for ${kind}`);
  }
  assert.ok(landing.includes('© 2026'));
  assert.ok(landing.includes('wh2tedev'));
  assert.ok(landing.includes('Monaco Editor'));
  assert.ok(landing.includes('Not affiliated with Microsoft or GitHub'));
});

test('the Privacy text names every server Zern can contact', () => {
  const privacy = landing.slice(landing.indexOf('<template id="l-tpl-privacy"'), landing.indexOf('<template id="l-tpl-licenses"'));
  for (const host of ['api.github.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net']) assert.ok(privacy.includes(host), `Privacy does not mention ${host}`);
});

test('the licenses panel agrees with THIRD_PARTY_NOTICES.txt', () => {
  const lic = landing.slice(landing.indexOf('<template id="l-tpl-licenses"'));
  for (const name of ['Monaco Editor', 'TypeScript', 'Codicons', 'JSZip', 'Inter', 'Lora', 'JetBrains Mono', 'Electron', 'Chromium', 'Nord']) assert.ok(lic.includes(name), name);
  const monaco = read('THIRD_PARTY_NOTICES.txt').match(/Monaco Editor (\d+\.\d+\.\d+)/)[1];
  assert.ok(lic.includes(`Monaco Editor ${monaco}`), 'Monaco version differs from THIRD_PARTY_NOTICES.txt');
  assert.ok(read('js/editor.js').includes(`monaco-editor@${monaco}`), 'the CDN fallback should use the bundled Monaco version');
});

test('every in-page link points to an id that exists', () => {
  const ids = new Set([...landing.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of landing.matchAll(/href="#([\w-]+)"/g)) assert.ok(ids.has(m[1]), `#${m[1]}`);
});

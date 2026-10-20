'use strict';
// Small pure helpers the editor relies on: file types, paths, the virtual file tree and HTML tag auto-close.
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/esm');

test('file types and languages', async () => {
  const fu = await load('js/fs-utils.js');
  assert.strictEqual(fu.getFileExtension('App.JS'), 'js');
  assert.strictEqual(fu.getFileExtension('archive.tar.gz'), 'gz');
  assert.strictEqual(fu.getFileExtension('Dockerfile'), 'dockerfile');
  assert.strictEqual(fu.getFileExtension('noext'), '');
  assert.strictEqual(fu.getFileExtension('trailing.'), '');
  assert.strictEqual(fu.getFileExtension(null), '');
  assert.strictEqual(fu.getLanguageFromExtension('main.py'), 'python');
  assert.strictEqual(fu.getLanguageFromExtension('weird.zzz'), 'plaintext');
  assert.ok(fu.isImageExtension('logo.PNG'));
  assert.ok(!fu.isImageExtension('logo.svg')); // SVG is edited as markup
});

test('normalizePath', async () => {
  const { normalizePath } = await load('js/fs-utils.js');
  assert.strictEqual(normalizePath('src\\a.js'), '/src/a.js');
  assert.strictEqual(normalizePath('/src/'), '/src');
  assert.strictEqual(normalizePath('/'), '/');
  assert.strictEqual(normalizePath(''), '/');
});

test('virtual tree: find, insert, remove, sort', async () => {
  const fu = await load('js/fs-utils.js');
  const root = { name: 'root', type: 'folder', path: '/', children: [{ name: 'src', type: 'folder', path: '/src', children: [{ name: 'a.js', type: 'file', path: '/src/a.js', content: '' }] }] };
  assert.strictEqual(fu.findFileByPath(root, '/src/a.js').name, 'a.js');
  assert.strictEqual(fu.findFileByPath(root, '/src/missing.js'), null);
  assert.strictEqual(fu.findFolderByPath(root, '/src').name, 'src');
  fu.insertNode(root, '/src', { name: 'B.js', type: 'file', path: '/src/B.js', content: '' });
  fu.insertNode(root, '/', { name: 'docs', type: 'folder', path: '/docs', children: [] });
  fu.sortTree(root);
  assert.deepStrictEqual(root.children.map((c) => c.name), ['docs', 'src']); // folders first, then alphabetical
  assert.deepStrictEqual(root.children[1].children.map((c) => c.name), ['a.js', 'B.js']);
  fu.removeNode(root, '/src/a.js');
  assert.strictEqual(fu.findFileByPath(root, '/src/a.js'), null);
  const seen = [];
  fu.walkTree(root, (n) => seen.push(n.path));
  assert.ok(seen.includes('/src/B.js') && seen.includes('/docs'));
});

test('a file named like an attack is just a name to the tree', async () => {
  const fu = await load('js/fs-utils.js');
  const evil = '<img src=x onerror=alert(1)>.js';
  const root = { name: 'root', type: 'folder', path: '/', children: [] };
  fu.insertNode(root, '/', { name: evil, type: 'file', path: '/' + evil, content: '' });
  assert.strictEqual(fu.findFileByPath(root, '/' + evil).name, evil);
  assert.strictEqual(fu.getFileExtension(evil), 'js');
});

test('auto-close HTML tags', async () => {
  const { getAutoCloseTag } = await load('js/html-autoclose.js');
  const at = (text) => getAutoCloseTag(text, text.length - 1);
  assert.strictEqual(at('<div>'), '</div>');
  assert.strictEqual(at('<ul class="a">'), '</ul>');
  assert.strictEqual(at('<br>'), null);       // void element
  assert.strictEqual(at('<img src="x">'), null);
  assert.strictEqual(at('</div>'), null);     // already a closing tag
  assert.strictEqual(at('<div title="a>b">'), '</div>'); // a ">" inside an attribute does not end the tag
  assert.strictEqual(at('text only>'), null);
  assert.strictEqual(getAutoCloseTag('<p>', 0), null); // not pointing at ">"
});

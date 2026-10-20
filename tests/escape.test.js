'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/esm');

// Names an attacker could give to a file, a repository, a branch or a commit
const HOSTILE = [
  '<img src=x onerror=alert(1)>.js',
  '"><script>alert(document.cookie)</script>',
  "' onmouseover='alert(1)",
  '`${alert(1)}`',
  '<svg/onload=alert(1)>',
  'repo"><iframe srcdoc="<script>parent.x()</script>">',
  'feature/<img/src=x/onerror=alert(1)>',
  'a&b <c> "d" \'e\'',
];

test('escapeHtml neutralises every character HTML cares about', async () => {
  const { escapeHtml } = await load('js/escape.js');
  for (const bad of HOSTILE) {
    const out = escapeHtml(bad);
    assert.ok(!/[<>"'`]/.test(out), `unescaped character left in ${JSON.stringify(out)}`);
    // What the browser would show is the original text
    const decoded = out.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#96;/g, '`').replace(/&amp;/g, '&');
    assert.strictEqual(decoded, bad);
  }
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(42), '42');
});

test('escapeHtml is safe inside single- AND double-quoted attributes', async () => {
  const { escapeHtml } = await load('js/escape.js');
  const payload = `x' onfocus='alert(1)" autofocus="`;
  const html = `<input value='${escapeHtml(payload)}'><input value="${escapeHtml(payload)}">`;
  assert.strictEqual((html.match(/ onfocus/g) || []).length, 2); // present only as text inside the values
  assert.ok(!/value='[^']*'[^>]* onfocus=/.test(html));
});

test('cssToken keeps only class-name characters', async () => {
  const { cssToken } = await load('js/escape.js');
  assert.strictEqual(cssToken('git-branch'), 'git-branch');
  assert.strictEqual(cssToken('x" onload="alert(1)'), 'xonloadalert1');
  assert.strictEqual(cssToken('a b<c>'), 'abc');
  assert.strictEqual(cssToken(null), '');
});

test('safeHttpUrl allows only http(s)', async () => {
  const { safeHttpUrl } = await load('js/escape.js');
  assert.strictEqual(safeHttpUrl('https://github.com/wh2tedev/zern'), 'https://github.com/wh2tedev/zern');
  assert.strictEqual(safeHttpUrl('http://localhost:8080/x'), 'http://localhost:8080/x');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '//evil.test/x', '/relative', '', null, undefined]) {
    assert.strictEqual(safeHttpUrl(bad), '', String(bad));
  }
});

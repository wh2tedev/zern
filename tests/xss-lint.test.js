'use strict';
// Static XSS guard: every ${...} that lands inside an HTML string must be escaped, a constant, or reviewed.
const test = require('node:test');
const assert = require('node:assert');
const { htmlInterpolations } = require('./helpers/template-scan');
const { isSafe } = require('./helpers/xss-rules');
const { appSources, rel, read } = require('./helpers/source-files');
const allowlist = require('./xss-allowlist');

const sources = appSources();

test('the scanner itself understands nested templates, strings and regexes', () => {
  const src = "const a = `<b>${x}</b>`; const r = /`${y}/; const s = '${z}'; const n = `<i>${list.map((v) => `<u>${v}</u>`).join('')}</i>`;";
  const found = htmlInterpolations(src).flatMap((t) => t.exprs);
  assert.deepStrictEqual(found.sort(), ['list.map((v) => `<u>${v}</u>`).join(\'\')', 'v', 'x'].sort());
});

test('the safety rules accept escaped values and reject raw ones', () => {
  for (const ok of ["escapeHtml(name)", "esc(a.b) ", "'literal'", "Number(n) || 0", "a ? 'x' : 'y'", "' (' + esc(k) + ')'", "list.length"]) assert.ok(isSafe(ok), ok);
  for (const bad of ['name', 'g.branch', 'escapeHtml(a) + b', "a ? name : 'y'", 'user.login']) assert.ok(!isSafe(bad), bad);
});

test('every value put inside an HTML string is escaped or reviewed (see tests/xss-allowlist.js)', () => {
  const problems = [];
  const used = new Map(); // file -> Set of allowlist keys that were needed
  for (const file of sources) {
    const name = rel(file);
    for (const t of htmlInterpolations(read(file))) {
      for (const expr of t.exprs) {
        if (isSafe(expr)) continue;
        const entry = allowlist[name];
        if (entry && Object.prototype.hasOwnProperty.call(entry, expr.trim())) {
          if (!used.has(name)) used.set(name, new Set());
          used.get(name).add(expr.trim());
          continue;
        }
        problems.push(`${name}:${t.line}  \${${expr.length > 90 ? expr.slice(0, 90) + '…' : expr}}`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], `Unescaped values in HTML strings. Wrap them with escapeHtml() from js/escape.js:\n  ${problems.join('\n  ')}`);

  const stale = [];
  for (const [name, entries] of Object.entries(allowlist)) {
    for (const key of Object.keys(entries)) if (!(used.get(name) || new Set()).has(key)) stale.push(`${name}: ${key}`);
  }
  assert.deepStrictEqual(stale, [], `tests/xss-allowlist.js has entries the code no longer needs; remove them:\n  ${stale.join('\n  ')}`);
});

test('no eval, new Function or document.write in the app', () => {
  const offenders = [];
  for (const file of sources) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
    if (/\beval\s*\(|new\s+Function\s*\(|document\.write(ln)?\s*\(/.test(code)) offenders.push(rel(file));
  }
  assert.deepStrictEqual(offenders, []);
});

test('there is a single escape helper (js/escape.js); other files import it', () => {
  const own = [];
  for (const file of sources) {
    const name = rel(file);
    if (name === 'js/escape.js') continue;
    const code = read(file);
    if (/(function\s+escapeHtml\b|const\s+(escapeHtml|esc)\s*=\s*\(?\s*\w+\s*\)?\s*=>)/.test(code) && !/from '(\.\.?\/)+escape\.js'/.test(code)) own.push(name);
  }
  // Extensions cannot import from the app: html-preview keeps a private copy for its 404 page (covered by the escape tests below)
  assert.deepStrictEqual(own, ['extensions/html-preview/main.js']);
});

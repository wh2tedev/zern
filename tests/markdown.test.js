'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/esm');

let render;
test.before(async () => { render = (await load('js/extensions/markdown.js')).renderMarkdown; });

test('renders the common Markdown', () => {
  const html = render('# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n---\n');
  for (const part of ['<h1>Title</h1>', '<strong>bold</strong>', '<em>italic</em>', '<del>gone</del>', '<code>code</code>', '<ul><li>one</li><li>two</li></ul>', '<ol><li>first</li><li>second</li></ol>', '<blockquote>quote</blockquote>', '<hr>']) {
    assert.ok(html.includes(part), `missing ${part} in ${html}`);
  }
});

test('code blocks and tables', () => {
  const html = render('```js\nconst a = "<b>";\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  assert.ok(html.includes('<pre><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>'));
  assert.ok(html.includes('<th>a</th>') && html.includes('<td>2</td>'));
});

test('raw HTML in the text is shown as text, never run', () => {
  for (const payload of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<iframe src="javascript:alert(1)"></iframe>', '<a href="javascript:alert(1)">x</a>']) {
    const html = render(`Hello ${payload}\n\n# ${payload}\n\n- ${payload}\n\n> ${payload}\n\n| ${payload} |\n|---|\n| ${payload} |`);
    assert.ok(!/<(script|img|iframe|a href)/i.test(html.replace(/<a href="https?:[^"]*" target="_blank" rel="noopener noreferrer">/g, '')), html);
  }
});

test('links: only http(s) become links, always with noopener', () => {
  const ok = render('[site](https://example.com/a?b=1&c=2)');
  assert.ok(ok.includes('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site</a>'));
  for (const bad of ['[x](javascript:alert(1))', '[x](JAVASCRIPT:alert(1))', '[x](data:text/html,hi)', '[x](vbscript:msgbox)', '[x](file:///etc/passwd)']) {
    assert.ok(!/<a /i.test(render(bad)), bad);
  }
});

test('a quote in a link cannot break out of the attribute', () => {
  const html = render('[x](https://a.test/"onmouseover="alert(1))');
  assert.ok(!/onmouseover="/.test(html), html);
  const img = render('![a" onerror="alert(1)](https://a.test/x.png)');
  assert.ok(!/ onerror="/.test(img), img);
});

test('images: https or relative paths only', () => {
  assert.ok(render('![ok](https://a.test/x.png)').includes('<img alt="ok" src="https://a.test/x.png">'));
  assert.ok(render('![ok](pic.png)', 'ext/base/').includes('src="ext/base/pic.png"'));
  assert.ok(!/<img/.test(render('![x](javascript:alert(1))')));
  assert.ok(!/<img/.test(render('![x](data:image/svg+xml,<svg onload=alert(1)>)')));
});

test('handles empty and odd input without throwing', () => {
  assert.strictEqual(render(''), '');
  assert.strictEqual(render(null), '');
  assert.doesNotThrow(() => render('```\nunclosed'));
  assert.doesNotThrow(() => render('| a |\n| --- |'));
});

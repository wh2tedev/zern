'use strict';
// "What gets written when you save": the Save Actions extension's tidy-up, run against a fake Zern API.
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/esm');

async function tidyWith(settings) {
  const { activate } = await load('extensions/save-actions/main.js');
  let handler = null;
  activate({
    settings: { get: (k) => settings[k] },
    editor: { onWillSave: (fn) => { handler = fn; } },
    commands: { register() {} },
  });
  return (text, path = 'a.js', languageId = 'javascript') => handler({ text, path, languageId });
}

test('trims trailing whitespace but keeps line endings', async () => {
  const tidy = await tidyWith({ trimTrailingWhitespace: true });
  assert.strictEqual(tidy('a  \nb\t\nc'), 'a\nb\nc');
  assert.strictEqual(tidy('a  \r\nb \r\n'), 'a\r\nb\r\n');
});

test('Markdown keeps its trailing spaces (hard line breaks) when asked to', async () => {
  const tidy = await tidyWith({ trimTrailingWhitespace: true, skipMarkdown: true });
  assert.strictEqual(tidy('line one  \nline two', 'README.md', 'markdown'), 'line one  \nline two');
  assert.strictEqual(tidy('x  ', 'a.txt', 'plaintext'), 'x');
});

test('collapses extra blank lines at the end, using the file\'s own line ending', async () => {
  const tidy = await tidyWith({ trimFinalNewlines: true });
  assert.strictEqual(tidy('a\n\n\n\n'), 'a\n');
  assert.strictEqual(tidy('a\r\n\r\n\r\n'), 'a\r\n');
});

test('inserts the final newline only when missing', async () => {
  const tidy = await tidyWith({ insertFinalNewline: true });
  assert.strictEqual(tidy('a'), 'a\n');
  assert.strictEqual(tidy('a\n'), 'a\n');
  assert.strictEqual(tidy('a\r\nb'), 'a\r\nb\r\n');
  assert.strictEqual(tidy(''), '');
});

test('all options together, and nothing happens with everything off', async () => {
  const all = await tidyWith({ trimTrailingWhitespace: true, trimFinalNewlines: true, insertFinalNewline: true });
  assert.strictEqual(all('a  \nb  \n\n\n'), 'a\nb\n');
  const none = await tidyWith({});
  assert.strictEqual(none('a  \n\n\n'), 'a  \n\n\n');
});

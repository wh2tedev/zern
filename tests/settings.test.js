'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/esm');

let validateSettings;
test.before(async () => { validateSettings = (await load('js/settings-schema.js')).validateSettings; });

test('accepts valid values', () => {
  const r = validateSettings({ theme: 'nordic', fontSize: 16, tabSize: 2, wordWrap: 'on', minimap: false, autoSaveDelay: 1000 });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.values, { theme: 'nordic', fontSize: 16, tabSize: 2, wordWrap: 'on', minimap: false, autoSaveDelay: 1000 });
});

test('rejects wrong types, ranges, enums and unknown settings (and applies nothing from them)', () => {
  const r = validateSettings({ fontSize: 3, tabSize: 2.5, minimap: 'yes', wordWrap: 'maybe', theme: 'neon', nope: 1 });
  assert.strictEqual(r.errors.length, 6);
  assert.deepStrictEqual(r.values, {});
});

test('rejects non-objects', () => {
  for (const bad of [null, [], 'text', 7]) assert.strictEqual(validateSettings(bad).errors.length, 1);
});

test('keybindings: normalises, accepts null, flags reserved, duplicate and invalid combos', () => {
  const ok = validateSettings({ keybindings: { 'a.cmd': 'ctrl+shift+j', 'b.cmd': null } });
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.keybindings, { 'a.cmd': 'Ctrl+Shift+J', 'b.cmd': null });

  assert.match(validateSettings({ keybindings: { x: 'Ctrl+C' } }).errors[0], /used by the editor/);
  assert.match(validateSettings({ keybindings: { x: 'J' } }).errors[0], /not a valid shortcut/);
  assert.match(validateSettings({ keybindings: { x: 5 } }).errors[0], /string or null/);
  const dup = validateSettings({ keybindings: { a: 'Ctrl+J', b: 'ctrl+j' } });
  assert.match(dup.errors[0], /assigned to both/);
  assert.match(validateSettings({ keybindings: [] }).errors[0], /must be an object/);
});

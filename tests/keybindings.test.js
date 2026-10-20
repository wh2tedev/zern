'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers/esm');

let kb;
test.before(async () => { kb = await load('js/keybindings.js'); });

test('normalizeCombo gives one canonical spelling', () => {
  const cases = { 'ctrl+shift+p': 'Ctrl+Shift+P', 'CTRL + S': 'Ctrl+S', 'cmd+k': 'Ctrl+K', 'alt+up': 'Alt+Up', 'shift+ctrl+alt+x': 'Ctrl+Alt+Shift+X', f12: 'F12', 'ctrl+esc': 'Ctrl+Esc', 'ctrl+/': 'Ctrl+/' };
  for (const [input, want] of Object.entries(cases)) assert.strictEqual(kb.normalizeCombo(input), want, input);
});

test('normalizeCombo refuses nonsense', () => {
  for (const bad of ['', '   ', null, undefined, 42, 'ctrl+', 'ctrl+a+b', 'ctrl+f13', 'ctrl+banana']) assert.strictEqual(kb.normalizeCombo(bad), null, String(bad));
});

test('isValidBinding: needs Ctrl or Alt, or a function key', () => {
  assert.ok(kb.isValidBinding('Ctrl+J'));
  assert.ok(kb.isValidBinding('Alt+J'));
  assert.ok(kb.isValidBinding('F5'));
  assert.ok(kb.isValidBinding('Shift+F5'));
  assert.ok(!kb.isValidBinding('J'));
  assert.ok(!kb.isValidBinding('Shift+J'));
  assert.ok(!kb.isValidBinding('Ctrl+'));
});

test('reserved combos are the ones the editor owns', () => {
  for (const c of ['Ctrl+C', 'ctrl+v', 'Ctrl+Z']) assert.ok(kb.isReserved(c), c);
  assert.ok(!kb.isReserved('Ctrl+Alt+J'));
});

test('eventToCombo reads a keyboard event (Cmd counts as Ctrl) and ignores bare modifiers', () => {
  assert.strictEqual(kb.eventToCombo({ key: 'p', code: 'KeyP', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+P');
  assert.strictEqual(kb.eventToCombo({ key: 'k', code: 'KeyK', metaKey: true }), 'Ctrl+K');
  assert.strictEqual(kb.eventToCombo({ key: 'F12', code: 'F12' }), 'F12');
  assert.strictEqual(kb.eventToCombo({ key: 'ArrowUp', code: 'ArrowUp', altKey: true }), 'Alt+Up');
  assert.strictEqual(kb.eventToCombo({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), null);
});

test('toMonacoKeybinding maps modifiers and keys', () => {
  const ns = { KeyMod: { CtrlCmd: 2048, Alt: 512, Shift: 1024 }, KeyCode: { KeyP: 46, F12: 70, Slash: 90, Digit1: 22 } };
  assert.strictEqual(kb.toMonacoKeybinding(ns, 'Ctrl+Shift+P'), 2048 | 1024 | 46);
  assert.strictEqual(kb.toMonacoKeybinding(ns, 'F12'), 70);
  assert.strictEqual(kb.toMonacoKeybinding(ns, 'Ctrl+/'), 2048 | 90);
  assert.strictEqual(kb.toMonacoKeybinding(ns, 'Ctrl+1'), 2048 | 22);
  assert.strictEqual(kb.toMonacoKeybinding(ns, 'Ctrl+Backspace'), null); // no such key in this fake namespace
  assert.strictEqual(kb.toMonacoKeybinding(ns, 'nonsense+'), null);
});

test('commands: defaults, overrides, conflicts and reset', () => {
  kb.defineCommand('t.one', { label: 'One', key: 'Ctrl+Alt+1', run() {} });
  kb.defineCommand('t.two', { label: 'Two', key: 'Ctrl+Alt+2', run() {} });
  assert.strictEqual(kb.getKey('t.one'), 'Ctrl+Alt+1');
  assert.strictEqual(kb.findConflict('Ctrl+Alt+2', 't.one').id, 't.two');
  assert.strictEqual(kb.findConflict('Ctrl+Alt+9', 't.one'), null);
  kb.setKey('t.one', 'Ctrl+Alt+7');
  assert.strictEqual(kb.getKey('t.one'), 'Ctrl+Alt+7');
  assert.ok(kb.isModified('t.one'));
  kb.setKey('t.two', null);
  assert.strictEqual(kb.getKey('t.two'), null);
  kb.resetAll();
  assert.strictEqual(kb.getKey('t.one'), 'Ctrl+Alt+1');
  assert.strictEqual(kb.getKey('t.two'), 'Ctrl+Alt+2');
  assert.ok(!kb.isModified('t.one'));
  kb.undefineCommand('t.one'); kb.undefineCommand('t.two');
});

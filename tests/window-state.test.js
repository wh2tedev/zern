'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ws = require('../window-state');

const screen1080 = { x: 0, y: 0, width: 1920, height: 1080 };
const screenRight = { x: 1920, y: 0, width: 1920, height: 1080 };

test('sanitize: defaults for missing or broken data', () => {
  for (const raw of [null, undefined, 'x', 5, {}, { width: 'a', height: 2 }, { width: NaN, height: 500 }]) {
    const s = ws.sanitize(raw);
    assert.deepStrictEqual([s.width, s.height, s.maximized, s.x, s.y], [1280, 800, false, undefined, undefined], JSON.stringify(raw));
  }
});

test('sanitize: keeps good values, enforces the minimum size, drops absurd positions', () => {
  assert.deepStrictEqual(ws.sanitize({ width: 1000, height: 700, x: 10, y: 20, maximized: true }), { width: 1000, height: 700, x: 10, y: 20, maximized: true });
  const tiny = ws.sanitize({ width: 100, height: 100 });
  assert.deepStrictEqual([tiny.width, tiny.height], [820, 480]);
  assert.strictEqual(ws.sanitize({ width: 1000, height: 700, x: 1e9, y: 0 }).x, undefined);
  assert.strictEqual(ws.sanitize({ width: 1000, height: 700, maximized: 'yes' }).maximized, false);
});

test('fitToDisplays: a position on a connected screen is kept', () => {
  const s = ws.fitToDisplays({ width: 1000, height: 700, x: 200, y: 100, maximized: false }, [screen1080]);
  assert.deepStrictEqual([s.x, s.y], [200, 100]);
});

test('fitToDisplays: a window left on an unplugged monitor is re-centered (x/y dropped)', () => {
  const s = ws.fitToDisplays({ width: 1000, height: 700, x: 2500, y: 100, maximized: false }, [screen1080]);
  assert.strictEqual(s.x, undefined);
  assert.strictEqual(s.y, undefined);
  // ...but it stays when that monitor is there
  assert.strictEqual(ws.fitToDisplays({ width: 1000, height: 700, x: 2500, y: 100 }, [screen1080, screenRight]).x, 2500);
});

test('fitToDisplays: barely visible or with the title bar above the screen counts as lost', () => {
  assert.strictEqual(ws.fitToDisplays({ width: 1000, height: 700, x: 1900, y: 100 }, [screen1080]).x, undefined); // only 20px inside
  assert.strictEqual(ws.fitToDisplays({ width: 1000, height: 700, x: 100, y: -300 }, [screen1080]).x, undefined); // title bar off the top
  assert.strictEqual(ws.fitToDisplays({ width: 1000, height: 700, x: -900, y: 100 }, [screen1080]).x, undefined); // only 100px inside
});

test('fitToDisplays: shrinks a window bigger than the screen, never below the minimum', () => {
  const s = ws.fitToDisplays({ width: 4000, height: 3000 }, [screen1080]);
  assert.deepStrictEqual([s.width, s.height], [1920, 1080]);
  const small = ws.fitToDisplays({ width: 1000, height: 700 }, [{ x: 0, y: 0, width: 800, height: 600 }]);
  assert.deepStrictEqual([small.width, small.height], [800, 600]);
});

test('fitToDisplays: with no screen information it changes nothing', () => {
  const st = { width: 1000, height: 700, x: 5, y: 5, maximized: false };
  assert.deepStrictEqual(ws.fitToDisplays(st, []), st);
});

test('save + load round trip, atomic write, tolerant of a corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zern-ws-'));
  const file = path.join(dir, 'sub', 'window-state.json');
  assert.deepStrictEqual(ws.load(file), ws.sanitize(null)); // nothing yet
  assert.ok(ws.save(file, { width: 1111, height: 777, x: 12, y: 34, maximized: true }));
  assert.deepStrictEqual(ws.load(file), { width: 1111, height: 777, x: 12, y: 34, maximized: true });
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['window-state.json']); // no temp file left behind
  fs.writeFileSync(file, '{ not json');
  assert.deepStrictEqual(ws.load(file), ws.sanitize(null));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('snapshot stores the NORMAL bounds, so a maximized window restores to its real size', () => {
  const win = { getNormalBounds: () => ({ x: 50, y: 60, width: 1100, height: 700 }), isMaximized: () => true };
  assert.deepStrictEqual(ws.snapshot(win), { width: 1100, height: 700, x: 50, y: 60, maximized: true });
});

test('track: saves after moving (debounced) and on close', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zern-ws-'));
  const file = path.join(dir, 'w.json');
  const handlers = {};
  let bounds = { x: 1, y: 2, width: 900, height: 600 };
  const win = { on: (ev, fn) => { handlers[ev] = fn; }, isDestroyed: () => false, getNormalBounds: () => bounds, isMaximized: () => false };
  ws.track(win, file, 20);
  handlers.move(); handlers.resize(); handlers.move();
  await new Promise((r) => setTimeout(r, 80));
  assert.deepStrictEqual(ws.load(file), { width: 900, height: 600, x: 1, y: 2, maximized: false });
  bounds = { x: 7, y: 8, width: 1000, height: 650 };
  handlers.close();
  assert.deepStrictEqual(ws.load(file), { width: 1000, height: 650, x: 7, y: 8, maximized: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

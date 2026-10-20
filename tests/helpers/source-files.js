'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** Zern's own JavaScript that runs in the page (not vendor code, tests or generated files). */
function appSources() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js')) out.push(p);
    }
  })(path.join(ROOT, 'js'));
  const ext = path.join(ROOT, 'extensions');
  for (const d of fs.readdirSync(ext, { withFileTypes: true })) {
    if (d.isDirectory() && fs.existsSync(path.join(ext, d.name, 'main.js'))) out.push(path.join(ext, d.name, 'main.js'));
  }
  return out.sort();
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8');

module.exports = { ROOT, appSources, rel, read };

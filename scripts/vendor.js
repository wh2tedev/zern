#!/usr/bin/env node
// ============================================================
// vendor.js - Copies third-party browser assets from node_modules
// into assets/vendor/ so Zern works fully offline (npm run vendor).
//
//   JSZip is always refreshed from node_modules.
//   Monaco is already bundled; it is only copied when missing, or
//   with --force (for example after: npm i -D monaco-editor@<version>).
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const force = process.argv.includes('--force');
const abs = (p) => path.join(root, p);

const jobs = [
  { name: 'JSZip', from: 'node_modules/jszip/dist/jszip.min.js', to: 'assets/vendor/jszip/jszip.min.js' },
  { name: 'Monaco Editor', from: 'node_modules/monaco-editor/min', to: 'assets/vendor/monaco-editor/min', onlyIfMissing: 'assets/vendor/monaco-editor/min/vs/loader.js' },
];

for (const job of jobs) {
  const src = abs(job.from), dest = abs(job.to);
  if (job.onlyIfMissing && fs.existsSync(abs(job.onlyIfMissing)) && !force) {
    console.log(`= ${job.name}: already in assets/vendor (use --force to replace it)`);
    continue;
  }
  if (!fs.existsSync(src)) {
    console.log(`- ${job.name}: not in node_modules, keeping what is in assets/vendor (run "npm install" first to refresh it)`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
  console.log(`+ ${job.name}: updated`);
}

// ---- Monaco file list for the service worker (offline cache). Regenerated every run. ----
const minDir = abs('assets/vendor/monaco-editor/min');
if (fs.existsSync(path.join(minDir, 'vs', 'loader.js'))) {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (path.relative(minDir, full) !== path.join('vs', 'nls')) walk(full); } // translations are not needed
      else if (!/\.(d\.ts|map)$/.test(entry.name)) files.push(path.relative(minDir, full).split(path.sep).join('/'));
    }
  })(minDir);
  files.sort();
  const version = crypto.createHash('sha1').update(files.map((f) => `${f}:${fs.statSync(path.join(minDir, f)).size}`).join('\n')).digest('hex').slice(0, 10);
  fs.writeFileSync(abs('assets/vendor/monaco-editor/precache.json'), JSON.stringify({ version, files }) + '\n');
  console.log(`+ Monaco precache list: ${files.length} files (version ${version})`);
}

// ---- The app's icon set is generated from the Codicons font inside the Monaco copy ----
require('./build-icons.js').buildIcons();

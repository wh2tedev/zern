// ============================================================
// boot.js - Runs at the end of <body>, before the app modules, and
// before first paint matters. Kept as a file (not inline in
// index.html) so the page needs no inline scripts.
// ============================================================

(function () {
// One-time migration from the former name: copy kcode_* keys to zern_* so sessions and settings survive the rename.
try {
  var ks = [];
  for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('kcode_') === 0) ks.push(k); }
  ks.forEach(function (key) { var n = 'zern_' + key.slice(6); if (localStorage.getItem(n) === null) localStorage.setItem(n, localStorage.getItem(key)); });
} catch (e) { /* storage blocked */ }

// Reveal the welcome page only if it hasn't been dismissed yet.
try { if (localStorage.getItem('zern_landing_seen_v1') !== '1') document.getElementById('landing').hidden = false; }
catch (e) { document.getElementById('landing').hidden = false; }

// ZIP import/export needs JSZip: the local copy is in index.html; if it is missing, fall back to the CDN.
if (typeof window.JSZip === 'undefined') {
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  document.head.appendChild(s);
}
})();

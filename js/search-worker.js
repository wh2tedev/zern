// ============================================================
// search-worker.js - Runs the actual file-content search off the
// main thread, so large projects don't freeze the UI while
// searching. Self-contained on purpose (no imports) to avoid
// module-resolution issues across different hosting setups.
// ============================================================

const BINARY_EXT_BLOCKLIST = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'pdf', 'zip', 'rar', '7z', 'gz', 'tar',
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov',
  'wasm', 'exe', 'dll', 'so', 'bin',
]);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB per file
const MAX_MATCHES_PER_FILE = 200;

function normalizePath(path) {
  if (!path) return '/';
  let p = path.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function findMatches(content, qLower) {
  if (!qLower) return [];
  const lines = content.split('\n');
  const matches = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const lineText = lines[idx];
    const lower = lineText.toLowerCase();
    let from = 0;
    let pos;
    while ((pos = lower.indexOf(qLower, from)) !== -1) {
      matches.push({ lineNumber: idx + 1, lineText, matchStart: pos, matchEnd: pos + qLower.length });
      from = pos + qLower.length;
      if (matches.length >= MAX_MATCHES_PER_FILE) return matches;
    }
  }
  return matches;
}

async function searchRealFs(dirHandle, path, qLower, acc = []) {
  for await (const [name, handle] of dirHandle.entries()) {
    const entryPath = normalizePath(`${path === '/' ? '' : path}/${name}`);
    if (handle.kind === 'directory') {
      await searchRealFs(handle, entryPath, qLower, acc);
    } else {
      const dot = name.lastIndexOf('.');
      const ext = dot > -1 ? name.slice(dot + 1).toLowerCase() : '';
      if (BINARY_EXT_BLOCKLIST.has(ext)) continue;

      try {
        const file = await handle.getFile();
        if (file.size > MAX_FILE_SIZE) continue;
        const content = await file.text();
        const matches = findMatches(content, qLower);
        if (matches.length) {
          acc.push({ path: entryPath, name, content, handle, isVirtual: false, matches });
        }
      } catch {
        // not readable as text (binary, permission, etc.): skip it
      }
    }
  }
  return acc;
}

function walkVirtualTree(node, callback) {
  if (!node) return;
  callback(node);
  if (node.type === 'folder' && Array.isArray(node.children)) {
    node.children.forEach((child) => walkVirtualTree(child, callback));
  }
}

function searchVirtualFs(root, qLower) {
  const acc = [];
  walkVirtualTree(root, (node) => {
    if (node.type === 'file') {
      const content = node.content || '';
      const matches = findMatches(content, qLower);
      if (matches.length) {
        acc.push({ path: node.path, name: node.name, content, isVirtual: true, matches });
      }
    }
  });
  return acc;
}

self.onmessage = async (e) => {
  const { requestId, mode, qLower, rootHandle, virtualTree } = e.data;
  try {
    const results = mode === 'real'
      ? await searchRealFs(rootHandle, '/', qLower, [])
      : searchVirtualFs(virtualTree, qLower);
    self.postMessage({ requestId, results });
  } catch (err) {
    self.postMessage({ requestId, error: err.message || String(err) });
  }
};

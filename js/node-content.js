// ============================================================
// node-content.js - Lazy file contents for virtual-tree nodes.
// Normal virtual files always carry their text in `node.content`.
// Files of an opened GitHub repository are listed first and their
// content is downloaded the first time it's needed (open, diff,
// export...). github.js registers the loader; everything else just
// calls ensureNodeContent() and doesn't need to know.
// ============================================================

let loader = null;

export function setNodeContentLoader(fn) { loader = fn; }

/**
 * Makes sure `node.content` is a string.
 * @returns {Promise<boolean>} false when the file can't be shown as text (binary, too large, download failed)
 */
export async function ensureNodeContent(node) {
  if (typeof node.content === 'string') return true;
  if (loader && node.sha) return loader(node);
  node.content = '';
  return true;
}

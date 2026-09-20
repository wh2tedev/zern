// ============================================================
// fs-utils.js - Utilities for the virtual file tree and for
// mapping file extensions to Monaco languages.
// ============================================================

// Extension -> Monaco language id. Monaco ships proper tokenizers for
// every language listed here out of the box (loaded as part of the
// standard editor.main bundle), so mapping an extension here is enough
// to get real syntax highlighting for it - no extra grammar needed.
const EXTENSION_LANGUAGE_MAP = {
  html: 'html',
  htm: 'html',
  vue: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  pyw: 'python',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  xml: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  txt: 'plaintext',
  log: 'plaintext',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  php: 'php',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  ini: 'ini',
  toml: 'ini',
  cfg: 'ini',
  dockerfile: 'dockerfile',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  r: 'r',
  scala: 'scala',
  ps1: 'powershell',
  psm1: 'powershell',
  graphql: 'graphql',
  gql: 'graphql',
  hbs: 'handlebars',
  pug: 'pug',
  jade: 'pug',
  coffee: 'coffeescript',
  m: 'objective-c',
  mm: 'objective-c',
  fs: 'fsharp',
  fsx: 'fsharp',
  vb: 'vb',
  proto: 'protobuf',
  bicep: 'bicep',
  bat: 'bat',
  cmd: 'bat',
  clj: 'clojure',
  cljs: 'clojure',
  rst: 'restructuredtext',
  twig: 'twig',
  liquid: 'liquid',
  sol: 'solidity',
  hcl: 'hcl',
  tf: 'hcl',
  pas: 'pascal',
  pp: 'pascal',
  jl: 'julia',
  scm: 'scheme',
  st: 'st',
  wgsl: 'wgsl',
};

/**
 * Extracts a filename's extension (without the dot).
 * @param {string} filename
 * @returns {string} lowercase extension, or '' if it has none
 */
export function getFileExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const lower = filename.toLowerCase();

  if (lower === 'dockerfile') return 'dockerfile';

  const lastDot = lower.lastIndexOf('.');
  if (lastDot === -1 || lastDot === lower.length - 1) return '';
  return lower.slice(lastDot + 1);
}

/**
 * Determines the Monaco language id from a filename.
 * @param {string} filename
 * @returns {string} Monaco language identifier
 */
export function getLanguageFromExtension(filename) {
  const ext = getFileExtension(filename);
  return EXTENSION_LANGUAGE_MAP[ext] || 'plaintext';
}

// Raster image extensions that get a visual preview instead of being
// opened as text. SVG is deliberately excluded - people usually want
// to edit it as markup, just like real VS Code defaults to.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp']);

export function isImageExtension(filename) {
  return IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

/**
 * Normalizes a path so it always starts with '/' and never ends
 * with '/' (unless it's the root).
 * @param {string} path
 */
export function normalizePath(path) {
  if (!path) return '/';
  let p = path.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * Recursively finds a 'file' node by its exact path within the
 * virtual file tree.
 *
 * @param {object} node - tree root node (AppState.fileSystem)
 * @param {string} path - full file path, e.g. '/src/app.js'
 * @returns {object|null} the found node, or null
 */
export function findFileByPath(node, path) {
  if (!node) return null;
  const target = normalizePath(path);

  if (node.type === 'file' && normalizePath(node.path) === target) {
    return node;
  }

  if (node.type === 'folder' && Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findFileByPath(child, target);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Recursively finds a 'folder' node by its exact path.
 *
 * @param {object} node - tree root node
 * @param {string} path - full folder path
 * @returns {object|null}
 */
export function findFolderByPath(node, path) {
  if (!node) return null;
  const target = normalizePath(path);

  if (node.type === 'folder') {
    if (normalizePath(node.path) === target) return node;

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findFolderByPath(child, target);
        if (found) return found;
      }
    }
  }

  return null;
}

/**
 * Recursively finds the folder that directly contains (is the
 * immediate parent of) the node whose path matches `path`. Useful
 * for delete/rename/move operations.
 *
 * @param {object} node - tree root node
 * @param {string} path - path of the child whose parent we're looking for
 * @returns {object|null} the parent folder node, or null if not found
 */
export function findParentFolder(node, path) {
  if (!node || node.type !== 'folder' || !Array.isArray(node.children)) {
    return null;
  }

  const target = normalizePath(path);

  for (const child of node.children) {
    if (normalizePath(child.path) === target) {
      return node;
    }
    if (child.type === 'folder') {
      const found = findParentFolder(child, target);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Walks the entire tree, applying a callback to each node (file or folder).
 * @param {object} node
 * @param {(node: object, depth: number) => void} callback
 * @param {number} depth
 */
export function walkTree(node, callback, depth = 0) {
  if (!node) return;
  callback(node, depth);
  if (node.type === 'folder' && Array.isArray(node.children)) {
    for (const child of node.children) {
      walkTree(child, callback, depth + 1);
    }
  }
}

/**
 * Inserts a new node (file or folder) into the folder pointed to
 * by parentPath.
 * @param {object} root - tree root node
 * @param {string} parentPath - path of the destination folder
 * @param {object} newNode - node to insert { name, type, path, ... }
 * @returns {boolean} true if it was inserted successfully
 */
export function insertNode(root, parentPath, newNode) {
  const parent = findFolderByPath(root, parentPath);
  if (!parent) return false;
  if (!Array.isArray(parent.children)) parent.children = [];
  parent.children.push(newNode);
  return true;
}

/**
 * Removes a node from the tree given its exact path.
 * @param {object} root
 * @param {string} path
 * @returns {boolean} true if it was removed
 */
export function removeNode(root, path) {
  const parent = findParentFolder(root, path);
  if (!parent) return false;
  const target = normalizePath(path);
  const idx = parent.children.findIndex(c => normalizePath(c.path) === target);
  if (idx === -1) return false;
  parent.children.splice(idx, 1);
  return true;
}

/**
 * Sorts a folder's children: folders first, then files, both
 * alphabetically. Applied recursively.
 * @param {object} node
 */
export function sortTree(node) {
  if (!node || node.type !== 'folder' || !Array.isArray(node.children)) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });
  node.children.forEach(sortTree);
}

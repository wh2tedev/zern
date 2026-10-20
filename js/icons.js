// ============================================================
// icons.js - UI icons using real VS Code Codicons (folders,
// context menu). FILE icons by extension keep using your own
// language logos, untouched by theme or zi changes.
// ============================================================
import { getFileExtension } from './fs-utils.js';

// Folder where you should place your language logos.
// Each file must be named exactly like the value below,
// e.g. html.svg, css.svg, js.svg, py.svg, etc.
export const ICON_BASE_PATH = 'assets/icons/languages/';

const ICON_FILES = {
  html: 'html.svg',
  htm: 'html.svg',
  vue: 'vue.svg',
  css: 'css.svg',
  scss: 'scss.svg',
  less: 'less.svg',
  js: 'js.svg',
  mjs: 'js.svg',
  cjs: 'js.svg',
  jsx: 'jsx.svg',
  ts: 'ts.svg',
  tsx: 'tsx.svg',
  json: 'json.svg',
  jsonc: 'json.svg',
  md: 'md.svg',
  markdown: 'md.svg',
  mdx: 'md.svg',
  py: 'py.svg',
  pyw: 'py.svg',
  xml: 'xml.svg',
  svg: 'svg.svg',
  yml: 'yaml.svg',
  yaml: 'yaml.svg',
  txt: 'txt.svg',
  log: 'txt.svg',
  sh: 'shell.svg',
  bash: 'shell.svg',
  zsh: 'shell.svg',
  sql: 'sql.svg',
  php: 'php.svg',
  java: 'java.svg',
  c: 'c.svg',
  h: 'c.svg',
  cpp: 'cpp.svg',
  cc: 'cpp.svg',
  hpp: 'cpp.svg',
  cs: 'csharp.svg',
  go: 'go.svg',
  rs: 'rust.svg',
  rb: 'ruby.svg',
  ini: 'ini.svg',
  toml: 'ini.svg',
  cfg: 'ini.svg',
  dockerfile: 'docker.svg',
  env: 'env.svg',
  kt: 'kotlin.svg',
  kts: 'kotlin.svg',
  swift: 'swift.svg',
  dart: 'dart.svg',
  lua: 'lua.svg',
  pl: 'perl.svg',
  pm: 'perl.svg',
  r: 'r.svg',
  scala: 'scala.svg',
  ps1: 'powershell.svg',
  psm1: 'powershell.svg',
  graphql: 'graphql.svg',
  gql: 'graphql.svg',
  coffee: 'coffeescript.svg',
  fs: 'fsharp.svg',
  fsx: 'fsharp.svg',
  vb: 'vb.svg',
  proto: 'protobuf.svg',
  clj: 'clojure.svg',
  cljs: 'clojure.svg',
};

// Generic embedded file icon (data URI), used when the language logo
// is missing or fails to load.
const FALLBACK_DATA_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">' +
  '<path fill="#c5c5c5" d="M4 1h6l4 4v12H4V1z"/>' +
  '<path fill="#8c8c8c" d="M10 1l4 4h-4V1z"/></svg>'
);

function iconImg(fileName) {
  return `<img class="file-icon-img" src="${ICON_BASE_PATH}${fileName}" width="16" height="16" alt="" onerror="this.onerror=null;this.src='${FALLBACK_DATA_URI}';">`;
}

const FALLBACK_IMG_TAG = `<img class="file-icon-img" src="${FALLBACK_DATA_URI}" width="16" height="16" alt="">`;

// ---------- FILE icons by extension (kept exactly as-is) ----------
export function getFileIcon(filename) {
  if (filename && filename.toLowerCase() === '.gitignore') {
    return iconImg('gitignore.svg');
  }
  const ext = getFileExtension(filename);
  const file = ICON_FILES[ext];
  return file ? iconImg(file) : FALLBACK_IMG_TAG;
}

// ---------- FOLDER icons -> real Codicons ----------
export function getFolderIcon(expanded) {
  return expanded
    ? '<i class="zi zi-folder-opened folder-zi"></i>'
    : '<i class="zi zi-folder folder-zi"></i>';
}

// ---------- Context menu icons -> real Codicons ----------
export const MENU_ICONS = {
  newFile: '<i class="zi zi-new-file"></i>',
  newFolder: '<i class="zi zi-new-folder"></i>',
  rename: '<i class="zi zi-edit"></i>',
  delete: '<i class="zi zi-trash"></i>',
  duplicate: '<i class="zi zi-files"></i>',
  copy: '<i class="zi zi-copy"></i>',
  close: '<i class="zi zi-close"></i>',
  closeAll: '<i class="zi zi-close-all"></i>',
  reveal: '<i class="zi zi-folder-opened"></i>',
};

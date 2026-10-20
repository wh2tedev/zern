// Interpolations inside HTML templates that are safe for a reason the scanner cannot see.
// Every entry says why. If `npm test` flags a NEW ${...} in an HTML string, the right fix is almost always
// to wrap it with escapeHtml() (js/escape.js). Add it here only when it is really a constant, a number or markup built by Zern.
'use strict';

const CONST = 'constant defined in this file';
const NUM = 'a number';
const ICON = 'icon markup built by Zern from constant names';
const NAME = 'call site passes a constant icon / label name (never user data)';

module.exports = {
  'extensions/todo-tree/main.js': {
    'x.line': 'line number produced by the scanner (an integer)',
  },
  'js/about.js': { APP_VERSION: CONST },
  'js/context-menu.js': { "item.icon || ''": 'icon is HTML supplied by Zern (MENU_ICONS, cssToken-built icons); label and keybinding ARE escaped' },
  'js/extensions/markdown.js': {
    alt: 'whole input is escaped before the inline rules run',
    "/^https:/.test(u) ? u : assetBase + u": 'u comes from the escaped text (no quotes or spaces can survive) and is limited to https: or a relative path',
    'code[i]': 'inline code taken from the already escaped text',
    x: 'list item built by inline() / task(), both escape first',
    'inline(m[2])': 'inline() escapes first',
    "inline(buf.join(' '))": 'inline() escapes first',
    'inline(c)': 'inline() escapes first',
  },
  'js/extensions/view.js': {
    cls: 'constant class suffix passed by the caller',
    VERIFIED_TIP: CONST,
    key: 'group key: constant "installed" / "available"',
    open: 'boolean (aria-expanded)',
    title: 'group title: constant',
    id: 'already escaped: const id = esc(e.id)',
    k: 'attribute string built from esc() values',
    body: 'section body built by featuresHtml() from esc() values',
    label: 'constant menu label',
    state: 'constant status sentence',
    t: 'tab name from the constant list in tabsFor()',
    't === tab': 'boolean',
    't[0].toUpperCase() + t.slice(1)': 'tab name from the constant list in tabsFor()',
    "items.length ? items.map(itemHtml).join('') : `<p class=\"ext-empty\">${query ? 'No extensions match your search.' : 'Nothing here yet.'}</p>`": 'itemHtml() escapes every field',
    "e.verified ? badge() : ''": 'badge() is a constant',
    "e.verified ? badge('lg') : ''": 'badge() is a constant',
    'settingControl(e, s)': 'settingControl() escapes every field',
    'actionsHtml(e)': 'actionsHtml() escapes the id',
    "menuRows.join('')": 'rows built from esc() values',
  },
  'js/icons.js': {
    ICON_BASE_PATH: CONST,
    fileName: 'always a value of the ICON_FILES table (never the real file name)',
    FALLBACK_DATA_URI: CONST,
  },
  'js/keybindings-ui.js': {
    "captured ? caps(captured) : 'Press the new shortcut…'": 'caps() escapes every key name',
    keyCell: 'built by caps() (escaped) or a constant',
  },
  'js/problems.js': {
    error: NUM, warning: NUM,
    'getFileIcon(name)': 'markup from the ICON_FILES table',
    'sevIcon(m.kind)': 'sevIcon() passes the kind through cssToken()',
    'm.startLineNumber': NUM, 'm.startColumn': NUM,
  },
  'js/scm-panel.js': {
    name: NAME,
    "icon('github')": ICON, "icon('repo')": ICON, "icon('cloud-download')": ICON, "icon('git-branch')": ICON, "icon('arrow-down')": ICON,
    "icon(r.isPrivate ? 'lock' : 'repo')": ICON, "icon(g.isPrivate ? 'lock' : 'repo')": ICON,
    "icon(ui.collapsed[key] ? 'chevron-right' : 'chevron-down')": ICON,
    'storageOptionsHtml()': 'static markup',
    avatar: 'built above from safeHttpUrl() + escapeHtml(), or an icon',
    'relativeTime(r.pushedAt)': 'a phrase like "3d ago" built from a date',
    'getFileIcon(name)': 'markup from the ICON_FILES table',
    title: 'group title: constant ("Staged Changes" / "Changes")',
    behindN: 'forced to a number with Number()',
  },
  'js/search.js': {
    before: 'escapeHtml() applied on the line above',
    hit: 'escapeHtml() applied on the line above',
    after: 'escapeHtml() applied on the line above',
  },
};

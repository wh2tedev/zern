// ============================================================
// menus.js - Menu items contributed by extensions.
//   explorer/context: right-click menu of the file explorer.
//   (editor/context is handled as native Monaco actions, see editor.js)
// ============================================================
import { cssToken } from '../escape.js';

const explorerItems = new Set();

/** item: { label, icon?, when?: 'file' | 'folder', run({ path, type }) } */
export function registerExplorerItem(item) {
  explorerItems.add(item);
  return { dispose() { explorerItems.delete(item); } };
}

/** Items to append to the explorer menu for the entry under the pointer (with a leading separator). */
export function explorerMenuItems(ctx) {
  const out = [];
  for (const item of explorerItems) {
    if (item.when && item.when !== ctx.type) continue;
    out.push({ label: item.label, icon: item.icon ? `<i class="zi zi-${cssToken(item.icon)}"></i>` : undefined, action: () => item.run(ctx) });
  }
  return out.length ? [{ separator: true }, ...out] : [];
}

// ============================================================
// settings-schema.js - What settings.json may contain and the check
// that decides whether a document is valid. No DOM and no Monaco, so
// `npm test` can run it. settings-json.js builds the tab around it.
// ============================================================
import { THEMES } from './themes.js';
import * as kb from './keybindings.js';

export const SCHEMA = {
  theme: { description: 'Color theme of the whole editor.', enum: () => Object.keys(THEMES) },
  uiFont: { description: 'Font of the interface (not the code).', enum: ['system', 'inter', 'mono', 'serif'] },
  fontSize: { description: 'Code font size in pixels.', integer: [8, 40] },
  tabSize: { description: 'Spaces per indentation level.', integer: [1, 8] },
  lineHeight: { description: 'Line height in pixels. 0 = automatic.', integer: [0, 60] },
  wordWrap: { description: 'Wrap long lines.', enum: ['on', 'off'] },
  minimap: { description: 'Show the minimap.', boolean: true },
  cursorStyle: { description: 'Shape of the cursor.', enum: ['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'] },
  renderWhitespace: { description: 'When to draw whitespace characters.', enum: ['none', 'boundary', 'selection', 'trailing', 'all'] },
  bracketPairColorization: { description: 'Color matching bracket pairs.', boolean: true },
  autoCloseTags: { description: 'Close HTML tags automatically.', boolean: true },
  semanticValidation: { description: 'Report type errors in JS/TS files.', boolean: true },
  smoothScrolling: { description: 'Animate scrolling.', boolean: true },
  formatOnSave: { description: 'Format the document when saving.', boolean: true },
  autoSave: { description: 'Save files automatically.', boolean: true },
  autoSaveDelay: { description: 'Milliseconds to wait before autosaving.', integer: [200, 60000] },
};

/** Returns { errors: string[], values: object, keybindings: object|undefined } */
export function validateSettings(doc) {
  const errors = [], values = {};
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { errors: ['The document must be a JSON object.'], values };
  let keybindings;
  for (const [key, v] of Object.entries(doc)) {
    if (key === 'keybindings') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push('"keybindings" must be an object.'); continue; }
      const seen = new Map(), clean = {};
      for (const [id, raw] of Object.entries(v)) {
        if (raw !== null && typeof raw !== 'string') { errors.push(`Shortcut for "${id}" must be a string or null.`); continue; }
        if (raw === null) { clean[id] = null; continue; }
        const combo = kb.normalizeCombo(raw);
        if (!combo || !kb.isValidBinding(combo)) { errors.push(`"${raw}" is not a valid shortcut for "${id}" (use Ctrl or Alt with a key, or F1 to F12).`); continue; }
        if (kb.isReserved(combo)) { errors.push(`${combo} is used by the editor and cannot be assigned to "${id}".`); continue; }
        if (seen.has(combo)) { errors.push(`${combo} is assigned to both "${seen.get(combo)}" and "${id}".`); continue; }
        seen.set(combo, id); clean[id] = combo;
      }
      // a combo can't also be the live binding of a command that is not being rebound here
      for (const [id, combo] of Object.entries(clean)) {
        if (!combo) continue;
        const other = kb.findConflict(combo, id);
        if (other && !(other.id in clean)) errors.push(`${combo} is already used by "${other.label}". Unassign it first ("${other.id}": null).`);
      }
      keybindings = clean;
      continue;
    }
    const s = SCHEMA[key];
    if (!s) { errors.push(`Unknown setting "${key}".`); continue; }
    if (s.boolean) { if (typeof v !== 'boolean') errors.push(`"${key}" must be true or false.`); else values[key] = v; }
    else if (s.integer) {
      if (!Number.isInteger(v) || v < s.integer[0] || v > s.integer[1]) errors.push(`"${key}" must be a whole number from ${s.integer[0]} to ${s.integer[1]}.`); else values[key] = v;
    } else {
      const allowed = typeof s.enum === 'function' ? s.enum() : s.enum;
      if (!allowed.includes(v)) errors.push(`"${key}" must be one of: ${allowed.join(', ')}.`); else values[key] = v;
    }
  }
  return { errors, values, keybindings };
}

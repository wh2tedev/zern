// ============================================================
// settings-json.js - settings.json: every setting plus your custom
// shortcuts as one JSON document that opens in an editor tab, like in
// VS Code, with autocomplete and validation (a JSON schema) powered by
// Monaco. Ctrl+S validates and applies it; nothing is applied until it
// is valid, so a typo can never leave the editor half-configured.
// ============================================================
import { AppState } from './state.js';
import * as kb from './keybindings.js';
import { SCHEMA, validateSettings } from './settings-schema.js';
import { showToast } from './notifications.js';
import { openCustomDocument } from './editor.js';

export { validateSettings };

const PATH = 'zern:/settings.json'; // key of the tab (not a file on disk)
let hooks = null;      // { apply(values), currentTheme() } supplied by app.js

export function initSettingsJson(h) { hooks = h; }

// ---------------- document <-> settings ----------------
function currentValues() {
  const c = AppState.config, out = {};
  for (const key of Object.keys(SCHEMA)) out[key] = key === 'theme' ? (hooks ? hooks.currentTheme() : c.theme) : c[key];
  out.keybindings = { ...(c.keybindings || {}) };
  return out;
}

function schemaForMonaco() {
  const props = {};
  for (const [k, s] of Object.entries(SCHEMA)) {
    const en = typeof s.enum === 'function' ? s.enum() : s.enum;
    props[k] = s.boolean ? { type: 'boolean', description: s.description }
      : s.integer ? { type: 'integer', minimum: s.integer[0], maximum: s.integer[1], description: s.description }
      : { type: 'string', enum: en, description: s.description };
  }
  const kbProps = {};
  for (const c of kb.listCommands()) kbProps[c.id] = { type: ['string', 'null'], description: `${c.label}${c.defaultKey ? ` (default ${c.defaultKey})` : ''}. null removes the shortcut.` };
  props.keybindings = { type: 'object', description: 'Custom shortcuts: { "commandId": "Ctrl+Shift+K" }. Only the ones you changed.', properties: kbProps, additionalProperties: { type: ['string', 'null'] } };
  return { type: 'object', properties: props, additionalProperties: false };
}

// ---------------- the tab ----------------
const buildText = () => JSON.stringify(currentValues(), null, 2);
const canonical = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));

/** Called when the tab is saved (Ctrl+S): resolves to true only if the settings were valid and applied. */
async function saveFromText(text) {
  let doc;
  try { doc = JSON.parse(text); }
  catch (e) { showToast({ type: 'error', title: 'settings.json is not valid JSON', message: e.message }); return false; }
  const { errors, values, keybindings } = validateSettings(doc);
  if (errors.length) {
    showToast({ type: 'error', title: 'Settings not applied', message: errors.slice(0, 3).join('\n') + (errors.length > 3 ? `\n(+${errors.length - 3} more)` : ''), timeout: 7000 });
    return false;
  }
  hooks.apply(values);
  if (keybindings) kb.replaceOverrides(keybindings);
  showToast({ type: 'success', message: 'Settings saved.', timeout: 2200 });
  return true;
}

function configureSchema() {
  const monaco = window.monaco;
  if (!monaco) throw new Error('The editor engine is not loaded yet.');
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true, allowComments: false, enableSchemaRequest: false,
    schemas: [{ uri: 'zern://schema/settings.json', fileMatch: [monaco.Uri.parse(PATH).toString()], schema: schemaForMonaco() }],
  });
}

export function openSettingsJson() {
  try { configureSchema(); } catch (e) { showToast({ type: 'error', message: e.message }); return; }
  openCustomDocument({ path: PATH, name: 'settings.json', language: 'json', text: buildText(), refresh: buildText, save: saveFromText });
}

// Keep an open, unedited settings.json tab in sync with changes made from the Settings panel or the shortcuts screen
document.addEventListener('zern:config-changed', () => {
  const file = AppState.openFiles.get(PATH);
  if (!file || file.modified || !file.model) return;
  let fresh;
  try { fresh = buildText(); if (canonical(JSON.parse(file.model.getValue())) === canonical(JSON.parse(fresh))) return; } catch { /* unreadable text: replace it */ }
  file.savedContent = fresh; file.content = fresh;
  file.model.setValue(fresh);
});

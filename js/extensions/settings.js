// ============================================================
// settings.js - Per-extension settings. Extensions declare them in
// their manifest (contributes.settings) and read them with
// zern.settings.get(key). Values are kept in localStorage.
// Types: boolean | number (min, max) | enum (options) | string
// ============================================================
const KEY = 'zern_ext_settings_v1';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* storage unavailable */ } };
const defOf = (ext, key) => ((ext.contributes && ext.contributes.settings) || []).find((s) => s.key === key);

export function coerce(def, val) {
  if (!def) return val;
  if (def.type === 'boolean') return !!val;
  if (def.type === 'number') {
    let n = Number(val);
    if (!Number.isFinite(n)) return def.default;
    if (def.min != null) n = Math.max(def.min, n);
    if (def.max != null) n = Math.min(def.max, n);
    return n;
  }
  if (def.type === 'enum') return (def.options || []).some((o) => o.value === val) ? val : def.default;
  return String(val);
}

const announce = (ext, key, value) => document.dispatchEvent(new CustomEvent('zern:ext-setting', { detail: { ext: ext.id, key, value } }));

export function getSetting(ext, key) {
  const def = defOf(ext, key), stored = read()[ext.id];
  return stored && key in stored ? coerce(def, stored[key]) : (def ? def.default : undefined);
}
export function isModified(ext, key) { const s = read()[ext.id]; return !!(s && key in s); }
export function setSetting(ext, key, value) {
  const all = read(), v = coerce(defOf(ext, key), value);
  (all[ext.id] = all[ext.id] || {})[key] = v;
  write(all); announce(ext, key, v);
}
export function resetSetting(ext, key) {
  const all = read();
  if (all[ext.id]) { delete all[ext.id][key]; write(all); }
  announce(ext, key, getSetting(ext, key));
}

// ============================================================
// escape.js - The ONE place that turns untrusted text into HTML-safe
// text. File names, repository names, branch names, commit messages,
// error messages and extension manifests must go through these helpers
// whenever they are put inside an HTML string (innerHTML, srcdoc...).
// Prefer textContent / createElement when you can; use these when you
// must build markup as a string.
// ============================================================

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Safe for element content AND for single- or double-quoted attribute values. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (c) => MAP[c]);
}

/** Same as escapeHtml; the name documents that the result goes inside an attribute. */
export const escapeAttr = escapeHtml;

/** Keeps only characters valid in a CSS class / icon name ("git-branch" stays, "x onload=..." loses its spaces and symbols). */
export function cssToken(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '');
}

/** Returns the URL if it is http(s), otherwise ''. Blocks javascript:, data:, vbscript: and relative tricks. */
export function safeHttpUrl(value) {
  try {
    const u = new URL(String(value ?? ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}

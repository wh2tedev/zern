// Decides whether an interpolation inside an HTML template is safe on its own.
// Safe by rule: string literals, calls to the escape helpers, numbers, ternaries / concatenations of safe parts,
// nested templates (their own ${} are checked separately) and .map() chains that build such templates.
// Everything else must be listed, with the reason, in tests/xss-allowlist.js.
'use strict';

const ESCAPERS = ['escapeHtml', 'esc', 'cssToken', 'escapeAttr'];

/** Splits at top level (outside strings, templates and brackets) on a single-character operator. */
function splitTop(expr, ch) {
  const parts = [];
  let depth = 0, last = 0, i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === "'" || c === '"') { for (i++; i < expr.length && expr[i] !== c; i++) if (expr[i] === '\\') i++; i++; continue; }
    if (c === '`') { let d = 0; for (i++; i < expr.length; i++) { if (expr[i] === '\\') i++; else if (expr[i] === '$' && expr[i + 1] === '{') d++; else if (expr[i] === '}' && d) d--; else if (expr[i] === '`' && !d) break; } i++; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ch && !depth) { parts.push(expr.slice(last, i)); last = i + 1; }
    i++;
  }
  parts.push(expr.slice(last));
  return parts;
}

const isStringLiteral = (e) => /^'(?:[^'\\]|\\.)*'$/.test(e) || /^"(?:[^"\\]|\\.)*"$/.test(e);

function isSingleEscapeCall(e) {
  const m = new RegExp(`^(${ESCAPERS.join('|')})\\(`).exec(e);
  if (!m) return false;
  let d = 0;
  for (let i = m[0].length - 1; i < e.length; i++) {
    if (e[i] === '(') d++;
    else if (e[i] === ')') { d--; if (!d) return i === e.length - 1; }
  }
  return false;
}

function isSafe(expr) {
  const e = expr.trim();
  if (!e) return true;
  if (isStringLiteral(e) || /^\d+$/.test(e)) return true;
  if (isSingleEscapeCall(e)) return true;
  if (/\.length$/.test(e) && /^[\w$.\[\]]+$/.test(e)) return true; // a count
  if (/^Number\(.*\)(\s*\|\|\s*\d+)?$/.test(e)) return true;
  if (e.startsWith('`')) return true; // nested template: its own interpolations are checked separately
  // list.map((x) => `<li>..</li>` or esc(x)).join('')
  if (/\.map\(/.test(e) && /\.join\((?:'[^']*')?\)$/.test(e) && /`|\bescapeHtml\(|\besc\(/.test(e)) return true;
  // cond ? a : b
  const q = splitTop(e, '?');
  if (q.length > 1) {
    const rest = q.slice(1).join('?');
    const branches = splitTop(rest, ':');
    if (branches.length >= 2) return isSafe(branches[0]) && isSafe(branches.slice(1).join(':'));
  }
  // a + b
  const plus = splitTop(e, '+');
  if (plus.length > 1) return plus.every(isSafe);
  // (a), (a || b)
  const paren = /^\(([\s\S]*)\)$/.exec(e);
  if (paren) return splitTop(paren[1], '|').filter(Boolean).every(isSafe);
  return false;
}

module.exports = { isSafe, splitTop };

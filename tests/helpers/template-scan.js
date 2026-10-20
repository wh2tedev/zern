// Finds every ${expression} inside JavaScript template literals that build HTML.
// Hand-written scanner (no dependencies): understands strings, comments, regex literals and nested templates.
'use strict';

const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]$|(^|[^\w$.])(return|typeof|case|in|of|delete|void|throw|else|do)$/;

function skipString(src, i, q) {
  for (i++; i < src.length; i++) { if (src[i] === '\\') i++; else if (src[i] === q) return i + 1; }
  return i;
}
function skipRegex(src, i) {
  let inClass = false;
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) { i++; while (/[a-z]/i.test(src[i] || '')) i++; return i; }
    else if (c === '\n') return i;
  }
  return i;
}

/** Parses one template literal starting at the backtick. Returns { end, text, exprs: [{ code, index }] }. */
function readTemplate(src, start) {
  let i = start + 1, text = '';
  const exprs = [];
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { text += src[i + 1] || ''; i += 2; continue; }
    if (c === '`') return { end: i + 1, text, exprs };
    if (c === '$' && src[i + 1] === '{') {
      const from = i + 2;
      let depth = 1, j = from;
      while (j < src.length && depth) {
        const d = src[j];
        if (d === "'" || d === '"') { j = skipString(src, j, d); continue; }
        if (d === '`') { j = readTemplate(src, j).end; continue; }
        if (d === '/' && src[j + 1] === '/') { while (j < src.length && src[j] !== '\n') j++; continue; }
        if (d === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j + 2) + 2 || src.length; continue; }
        if (d === '{') depth++;
        else if (d === '}') { depth--; if (!depth) break; }
        j++;
      }
      exprs.push({ code: src.slice(from, j).trim(), index: from });
      text += '\u0000';
      i = j + 1;
      continue;
    }
    text += c; i++;
  }
  return { end: i, text, exprs };
}

/** All templates (also the ones nested in expressions) that contain at least one ${...}. */
function scanTemplates(src, baseLine = 1) {
  const found = [];
  const lineAt = (idx) => baseLine + (src.slice(0, idx).match(/\n/g) || []).length;
  let i = 0, prev = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2 || src.length; continue; }
    if (c === "'" || c === '"') { i = skipString(src, i, c); prev = 'x'; continue; }
    if (c === '/' && REGEX_PREV.test(prev.trimEnd() || '(')) { i = skipRegex(src, i); prev = 'x'; continue; }
    if (c === '`') {
      const t = readTemplate(src, i);
      if (t.exprs.length) {
        found.push({ line: lineAt(i), text: t.text, exprs: t.exprs.map((e) => e.code) });
        for (const e of t.exprs) found.push(...scanTemplates(e.code, lineAt(e.index)));
      }
      i = t.end; prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = (prev + c).slice(-12);
    i++;
  }
  return found;
}

/** Templates that look like HTML (contain a tag) with their interpolations. */
function htmlInterpolations(src) {
  return scanTemplates(src).filter((t) => /<\/?[a-zA-Z]/.test(t.text.replace(/\u0000/g, '')));
}

module.exports = { scanTemplates, htmlInterpolations };

// ============================================================
// markdown.js - Tiny, safe Markdown renderer for extension README /
// CHANGELOG pages. Everything is escaped first; only http(s) links
// and relative images are allowed.
// ============================================================
import { escapeHtml } from '../escape.js';

// The inline-code rule below looks for literal backticks in the escaped text. A backtick is harmless in element content
// and inside the double-quoted attributes this file writes, so it is put back after the shared escape.
const esc = (s) => escapeHtml(s).replace(/&#96;/g, '`');

export function renderMarkdown(src, assetBase = '') {
  const inline = (raw) => {
    const code = [];
    let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => { code.push(c); return `\u0000${code.length - 1}\u0000`; });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => /^(https:|[^:]+$)/.test(u) ? `<img alt="${alt}" src="${/^https:/.test(u) ? u : assetBase + u}">` : m);
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*]+)\*(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
  };

  const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)/;
  const task = (t) => inline(t).replace(/^\[([ xX])\]\s+/, (m, c) => `<input type="checkbox" disabled${c === ' ' ? '' : ' checked'}> `);
  // Lists, with nesting by indentation
  const list = (ls, i) => {
    const first = ls[i].match(ITEM), base = first[1].length, tag = /\d+\./.test(first[2]) ? 'ol' : 'ul', items = [];
    while (i < ls.length) {
      const m = ls[i].match(ITEM);
      if (!m || m[1].length < base) break;
      if (m[1].length > base && items.length) { const [sub, ni] = list(ls, i); items[items.length - 1] += sub; i = ni; continue; }
      items.push(task(m[3])); i++;
    }
    return [`<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`, i];
  };

  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^```(\w*)/))) {
      const buf = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) buf.push(lines[i]);
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
    } else if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr>');
    } else if (/^>\s?/.test(line)) {
      const buf = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) buf.push(lines[i].replace(/^>\s?/, ''));
      i--; out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const [html, next] = list(lines, i);
      out.push(html); i = next - 1;
    } else if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line), rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (line.trim()) {
      const buf = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) buf.push(lines[i]);
      i--; out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

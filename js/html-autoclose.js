// ============================================================
// html-autoclose.js - Decides whether typing ">" should also insert
// a closing tag, and which one. Pure functions, no editor/DOM
// dependency, so the logic can be tested on its own.
//
// Typing the ">" of "<div class='a'" gives "<div class='a'></div>"
// with the cursor between the tags. Nothing is added for:
//   - void elements (br, img, input, meta, link, hr, ...)
//   - self-closing syntax ("<div />")
//   - closing tags ("</div>"), comments, <!DOCTYPE>, CDATA
//   - a ">" typed inside an attribute value ("<a title='a>b'")
//   - a ">" typed inside <script>, <style>, <textarea>, <title>
//     (their content is not markup), PHP/ASP blocks or {{ }} / {% %}
//
// To know that, the text is scanned from the start of the file up
// to the typed ">" with a small state machine, instead of just
// looking at the current line (tags often span several lines).
// ============================================================

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'command', 'embed', 'frame',
  'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Elements whose content is plain text, not markup.
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

// Monaco language id -> options. XML has no void elements and no raw-text elements.
export const AUTOCLOSE_MODES = {
  html: { html: true },
  php: { html: true },
  handlebars: { html: true },
  razor: { html: true },
  xml: { html: false },
};

const isAsciiLetter = (ch) => {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
};
const isNameChar = (ch) => /[A-Za-z0-9_:.\-]/.test(ch);
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';

function readName(text, from) {
  let j = from;
  while (j < text.length && isNameChar(text[j])) j++;
  return text.slice(from, j);
}

/** Index just past `end` if it appears before `limit`, otherwise -1 (still open at `limit`). */
function skipBlock(text, from, end, limit) {
  const e = text.indexOf(end, from);
  return e === -1 || e + end.length > limit ? -1 : e + end.length;
}

/** Index of the "<" of "</name" (case-insensitive, properly terminated) before `limit`, or -1. */
function findRawEnd(text, from, name, limit) {
  let idx = text.indexOf('</', from);
  while (idx !== -1 && idx < limit) {
    if (text.substr(idx + 2, name.length).toLowerCase() === name) {
      const after = text[idx + 2 + name.length];
      if (after === undefined || isSpace(after) || after === '/' || after === '>') return idx;
    }
    idx = text.indexOf('</', idx + 2);
  }
  return -1;
}

function previousSignificantChar(text, i) {
  let k = i - 1;
  while (k >= 0 && isSpace(text[k])) k--;
  return k >= 0 ? text[k] : '';
}

/**
 * @param {string} text  whole document, AFTER the ">" was typed
 * @param {number} gt    index of the typed ">" in `text`
 * @param {{html?: boolean}} [options]
 * @returns {string|null} the closing tag to insert right after the ">", or null
 */
export function getAutoCloseTag(text, gt, options = { html: true }) {
  if (gt < 1 || text[gt] !== '>') return null;
  const html = options.html !== false;

  let i = 0;
  let tag = null;  // tag being read: { name, isClose }
  let raw = null;  // name of the raw-text element we are inside of

  while (i < gt) {
    // ---- inside <script>/<style>/...: nothing is markup until the matching close tag
    if (raw) {
      const end = findRawEnd(text, i, raw, gt);
      if (end === -1) return null;
      i = end;
      raw = null;
      continue;
    }

    const ch = text[i];

    // ---- text between tags
    if (!tag) {
      if (ch !== '<') { // jump straight to the next "<" (or to the typed ">")
        const nx = text.indexOf('<', i + 1);
        i = nx === -1 || nx > gt ? gt : nx;
        continue;
      }
      const next = text[i + 1];

      if (text.startsWith('<!--', i)) {
        const e = skipBlock(text, i + 4, '-->', gt);
        if (e === -1) return null;
        i = e; continue;
      }
      if (text.startsWith('<![CDATA[', i)) {
        const e = skipBlock(text, i + 9, ']]>', gt);
        if (e === -1) return null;
        i = e; continue;
      }
      if (next === '!') { // <!DOCTYPE ...>
        const e = skipBlock(text, i + 2, '>', gt);
        if (e === -1) return null;
        i = e; continue;
      }
      if (next === '?' || next === '%') { // <?php ... ?>  /  <% ... %>
        const e = skipBlock(text, i + 2, next + '>', gt);
        if (e === -1) return null;
        i = e; continue;
      }
      if (next === '/' && isAsciiLetter(text[i + 2])) {
        const name = readName(text, i + 2);
        tag = { name, isClose: true };
        i += 2 + name.length;
        continue;
      }
      if (isAsciiLetter(next)) {
        const name = readName(text, i + 1);
        const after = text[i + 1 + name.length];
        if (after === undefined || isSpace(after) || after === '/' || after === '>') {
          tag = { name, isClose: false };
          i += 1 + name.length;
          continue;
        }
      }
      i++; // a lone "<" (e.g. "a < b") is just text
      continue;
    }

    // ---- inside a tag
    if (ch === '"' || ch === "'") {
      // Quotes only open an attribute value right after "=" ("<p don't>" has none)
      if (previousSignificantChar(text, i) !== '=') { i++; continue; }
      let j = i + 1;
      for (;;) {
        if (j >= gt) return null; // still inside the value when we reach the ">"
        const cj = text[j];
        if (cj === ch) break;
        if (cj === '<' && (text[j + 1] === '?' || text[j + 1] === '%')) {
          const e = skipBlock(text, j + 2, text[j + 1] + '>', gt);
          if (e === -1) return null;
          j = e; continue;
        }
        if (cj === '{' && (text[j + 1] === '{' || text[j + 1] === '%')) {
          const close = text[j + 1] === '{' ? '}}' : '%}';
          const e = skipBlock(text, j + 2, close, gt);
          if (e === -1) return null;
          j = e; continue;
        }
        j++;
      }
      i = j + 1;
      continue;
    }

    if (ch === '<') {
      if (text[i + 1] === '?' || text[i + 1] === '%') { // PHP/ASP block inside the tag
        const e = skipBlock(text, i + 2, text[i + 1] + '>', gt);
        if (e === -1) return null;
        i = e; continue;
      }
      // A new tag starts before the previous one was finished: forget the broken one
      if (isAsciiLetter(text[i + 1]) || text[i + 1] === '/' || text[i + 1] === '!') { tag = null; continue; }
      i++; continue;
    }

    if (ch === '{' && (text[i + 1] === '{' || text[i + 1] === '%')) { // {{ ... }} / {% ... %}
      const e = skipBlock(text, i + 2, text[i + 1] === '{' ? '}}' : '%}', gt);
      if (e === -1) return null;
      i = e; continue;
    }

    if (ch === '>') { // the tag ended before the typed ">"
      if (!tag.isClose && text[i - 1] !== '/' && html && RAW_TEXT_ELEMENTS.has(tag.name.toLowerCase())) {
        raw = tag.name.toLowerCase();
      }
      tag = null;
      i++;
      continue;
    }

    i++;
  }

  // The typed ">" must be closing an OPENING tag
  if (raw || !tag || tag.isClose) return null;
  if (text[gt - 1] === '/') return null; // "<div />"

  const name = tag.name;
  const lower = name.toLowerCase();
  // <br>/<BR> are void, but <Input>/<Link> (Vue/Angular components) are not
  if (html && VOID_ELEMENTS.has(lower) && (name === lower || name === name.toUpperCase())) return null;

  // Already followed by its own closing tag (e.g. you re-typed the ">" of "<div|></div>")
  const following = text.substr(gt + 1, name.length + 3);
  if (following.slice(0, 2) === '</' && following.slice(2, 2 + name.length).toLowerCase() === lower) {
    const after = following[2 + name.length];
    if (after === '>' || after === undefined || isSpace(after)) return null;
  }

  return `</${name}>`;
}

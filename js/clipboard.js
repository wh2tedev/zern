// ============================================================
// clipboard.js - Copy text to the clipboard. Uses the async
// Clipboard API when available (secure contexts) and falls back
// to a hidden <textarea> + execCommand for older/insecure ones.
// ============================================================

export async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('Async clipboard failed, trying the fallback:', err);
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (err) {
    console.error('Could not copy to the clipboard:', err);
    return false;
  }
}

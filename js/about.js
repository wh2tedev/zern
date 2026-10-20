// ============================================================
// about.js - "About Zern": version, license and trademark notice.
// ============================================================

import { APP_VERSION } from './version.js';
import { getMonacoSource } from './editor.js';

export function showAbout() {
  if (document.querySelector('.about-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay about-overlay';
  overlay.innerHTML = `
    <div class="confirm-panel about-panel" role="dialog" aria-label="About Zern">
      <div class="about-head">
        <span class="zern-mark" style="width:44px;height:44px" aria-hidden="true"></span>
        <div>
          <div class="confirm-title about-title">Zern</div>
          <div class="about-version">Version ${APP_VERSION}</div>
          <div class="about-version">Editor engine: ${getMonacoSource() === 'local' ? 'local copy (works offline)' : 'CDN (needs internet)'}</div>
        </div>
      </div>
      <div class="confirm-message">
        Licensed under the MIT License.<br>
        Zern is not affiliated with, endorsed by or sponsored by Microsoft or GitHub.
        Visual Studio Code is a trademark of Microsoft Corporation; GitHub is a trademark of GitHub, Inc.
      </div>
      <div class="confirm-actions">
        <a class="btn-secondary about-link" href="THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">Third-party licenses</a>
        <button class="btn-primary about-close" type="button">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 150);
  };
  function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') close(); }
  overlay.querySelector('.about-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.about-close').focus();
}

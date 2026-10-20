// ============================================================
// window-controls.js - Minimize / maximize / close buttons for the
// desktop app (Electron, frameless window). Does nothing in a browser.
// The title bar becomes the drag area (see css/desktop.css).
// ============================================================
export function initWindowControls() {
  const desktop = window.zernDesktop;
  const host = document.querySelector('.title-right');
  if (!desktop || !host) return;

  document.body.classList.add('is-desktop');
  const box = document.createElement('div');
  box.className = 'win-controls';
  box.innerHTML = `
    <button type="button" class="win-btn" data-w="minimize" title="Minimize" aria-label="Minimize"><i class="zi zi-chrome-minimize"></i></button>
    <button type="button" class="win-btn" data-w="toggle-maximize" title="Maximize" aria-label="Maximize"><i class="zi zi-chrome-maximize"></i></button>
    <button type="button" class="win-btn close" data-w="close" title="Close" aria-label="Close"><i class="zi zi-chrome-close"></i></button>`;
  host.appendChild(box);

  const maxBtn = box.querySelector('[data-w="toggle-maximize"]');
  const render = (state) => {
    const maximized = !!(state && state.maximized);
    maxBtn.title = maxBtn.ariaLabel = maximized ? 'Restore' : 'Maximize';
    maxBtn.firstElementChild.className = `zi zi-chrome-${maximized ? 'restore' : 'maximize'}`;
    document.body.classList.toggle('is-maximized', maximized);
  };

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (b) desktop.window(b.dataset.w).then(render);
  });
  // Double click on the empty part of the title bar maximizes / restores, like a native bar
  document.getElementById('title-bar').addEventListener('dblclick', (e) => {
    if (e.target.closest('button, nav, .win-controls')) return;
    desktop.window('toggle-maximize').then(render);
  });
  desktop.onWindowState(render);
  desktop.window('state').then(render);
}

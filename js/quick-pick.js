// ============================================================
// quick-pick.js - VS Code-style "quick pick" and "input box".
//   pickItem(...)  -> choose one item from a filterable list
//   promptText(..) -> type a short text
// Both resolve to null when dismissed (Esc / click outside).
// Re-uses the Go-to-File styling so they look native.
// ============================================================

function buildShell(placeholder) {
  const overlay = document.createElement('div');
  overlay.className = 'quick-open-overlay open quick-pick-overlay';
  overlay.innerHTML = `
    <div class="quick-open-panel">
      <div class="quick-open-input-wrapper"><input type="text" autocomplete="off" spellcheck="false"></div>
      <ul class="quick-open-list"></ul>
    </div>`;
  const input = overlay.querySelector('input');
  input.placeholder = placeholder || '';
  document.body.appendChild(overlay);
  setTimeout(() => input.focus(), 0);
  return { overlay, input, list: overlay.querySelector('.quick-open-list') };
}

export function pickItem({ placeholder, items, emptyText = 'No results' }) {
  return new Promise((resolve) => {
    const { overlay, input, list } = buildShell(placeholder);
    let filtered = items.slice();
    let active = 0;

    const close = (value) => { overlay.remove(); resolve(value); };

    const render = () => {
      list.innerHTML = '';
      if (!filtered.length) {
        const li = document.createElement('li');
        li.className = 'quick-open-empty';
        li.textContent = emptyText;
        list.appendChild(li);
        return;
      }
      filtered.forEach((item, i) => {
        const li = document.createElement('li');
        li.className = 'quick-open-item' + (i === active ? ' active' : '');
        const name = document.createElement('span');
        name.className = 'quick-open-name';
        name.textContent = item.label;
        li.appendChild(name);
        if (item.description) {
          const d = document.createElement('span');
          d.className = 'quick-open-path';
          d.textContent = item.description;
          li.appendChild(d);
        }
        li.addEventListener('mousemove', () => { if (active !== i) { active = i; markActive(); } });
        li.addEventListener('click', () => close(item.value));
        list.appendChild(li);
      });
    };
    const markActive = () => {
      [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
      const el = list.children[active];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    };

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      filtered = q ? items.filter((it) => `${it.label} ${it.description || ''}`.toLowerCase().includes(q)) : items.slice();
      active = 0;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      else if (e.key === 'ArrowDown' && filtered.length) { e.preventDefault(); active = (active + 1) % filtered.length; markActive(); }
      else if (e.key === 'ArrowUp' && filtered.length) { e.preventDefault(); active = (active - 1 + filtered.length) % filtered.length; markActive(); }
      else if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); close(filtered[active].value); }
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    render();
  });
}

export function promptText({ placeholder, value = '' }) {
  return new Promise((resolve) => {
    const { overlay, input } = buildShell(placeholder);
    input.value = value;
    const close = (v) => { overlay.remove(); resolve(v); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      else if (e.key === 'Enter') { e.preventDefault(); close(input.value.trim() || null); }
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
  });
}

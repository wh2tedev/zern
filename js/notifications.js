// ============================================================
// notifications.js - VS Code-style toasts (bottom-right),
// using real Codicons for the icons
// ============================================================

let container = null;

function ensureContainer() {
  if (!container) container = document.getElementById('notification-container');
  return container;
}

function getIconForType(type) {
  switch (type) {
    case 'success': return '<i class="zi zi-pass-filled" style="color:#89d185;"></i>';
    case 'error': return '<i class="zi zi-error" style="color:#f14c4c;"></i>';
    case 'warning': return '<i class="zi zi-warning" style="color:#cca700;"></i>';
    default: return '<i class="zi zi-info" style="color:#3794ff;"></i>';
  }
}

export function showToast({ type = 'info', title, message, timeout = 4000, actionLabel, onAction, secondaryLabel, onSecondary }) {
  const cont = ensureContainer();
  if (!cont) return null;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = getIconForType(type);
  toast.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'toast-body';
  if (title) {
    const t = document.createElement('div');
    t.className = 'toast-title';
    t.textContent = title;
    body.appendChild(t);
  }
  const m = document.createElement('div');
  m.className = 'toast-message';
  m.textContent = message || '';
  body.appendChild(m);
  toast.appendChild(body);

  const dismiss = () => {
    toast.classList.remove('toast-in');
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 200);
  };

  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { onAction(); dismiss(); });
    toast.appendChild(btn);
  }

  if (secondaryLabel && typeof onSecondary === 'function') {
    const btn2 = document.createElement('button');
    btn2.className = 'toast-action toast-action-secondary';
    btn2.textContent = secondaryLabel;
    btn2.addEventListener('click', () => { onSecondary(); dismiss(); });
    toast.appendChild(btn2);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '<i class="zi zi-close"></i>';
  closeBtn.addEventListener('click', dismiss);
  toast.appendChild(closeBtn);

  cont.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-in'));

  if (timeout > 0) setTimeout(dismiss, timeout);

  return { dismiss };
}

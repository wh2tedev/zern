// ============================================================
// main.js - Electron main process.
// Zern draws its own title bar and window buttons (see
// js/window-controls.js), so the native frame and menu are off.
// ============================================================
const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const windowStateStore = require('./window-state');

const ICON = path.join(__dirname, 'assets', 'logo', 'logo-512.png');

const windowState = (win) => ({ maximized: win.isMaximized(), fullscreen: win.isFullScreen() });

const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function createWindow() {
  // Size, position and maximized state from the last run, adapted to the screens connected now
  const saved = windowStateStore.fitToDisplays(windowStateStore.load(windowStateFile()), screen.getAllDisplays().map((d) => d.workArea));
  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined ? { x: saved.x, y: saved.y } : {}), // no position saved (or off screen): Electron centers it
    minWidth: windowStateStore.MIN_SIZE.width,   // below this the web layout hides the title bar (and with it the window buttons)
    minHeight: windowStateStore.MIN_SIZE.height,
    frame: false,
    title: 'Zern',
    icon: ICON,
    backgroundColor: '#121314',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  windowStateStore.track(win, windowStateFile());
  win.loadFile('index.html');

  // Tell the page when the window is maximized / full screen so the button icon follows
  const notify = () => { if (!win.isDestroyed()) win.webContents.send('zern:window-state', windowState(win)); };
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => win.on(ev, notify));

  // Links to the web open in the user's browser, never in a new bare window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Without the native menu these keep working: dev tools and full screen
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); event.preventDefault(); }
    else if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
  });
}

// Window buttons drawn by the page
ipcMain.handle('zern:window', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  if (action === 'minimize') win.minimize();
  else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (action === 'close') win.close();
  return windowState(win);
});

// ---- Secrets (the GitHub token) live encrypted by the OS keyring, never in the page's storage ----
const SECRET_KEYS = new Set(['github_token']);
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');
const readSecrets = () => { try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch { return {}; } };

// On Linux without a keyring Electron falls back to "basic_text" (no real encryption): treat that as unavailable.
function keyringAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return true;
  } catch { return false; }
}

ipcMain.handle('zern:secret-status', () => ({ available: keyringAvailable() }));
ipcMain.handle('zern:secret-get', (_e, key) => {
  if (!SECRET_KEYS.has(key) || !keyringAvailable()) return null;
  const enc = readSecrets()[key];
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
});
ipcMain.handle('zern:secret-set', (_e, key, value) => {
  if (!SECRET_KEYS.has(key) || typeof value !== 'string' || !keyringAvailable()) return false;
  const all = readSecrets();
  all[key] = safeStorage.encryptString(value).toString('base64');
  fs.writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 });
  return true;
});
ipcMain.handle('zern:secret-delete', (_e, key) => {
  if (!SECRET_KEYS.has(key)) return false;
  const all = readSecrets();
  delete all[key];
  try { fs.writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 }); } catch { /* nothing to delete */ }
  return true;
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // also frees Ctrl+W / Ctrl+R for the editor
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

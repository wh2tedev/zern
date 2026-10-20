// preload.js - the only bridge between the page and Electron.
// Exposes window.zernDesktop with just what the custom title bar needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zernDesktop', {
  platform: process.platform,
  /** action: 'minimize' | 'toggle-maximize' | 'close' | 'state'. Resolves to { maximized, fullscreen }. */
  window: (action) => ipcRenderer.invoke('zern:window', action),
  /** OS-keyring backed secrets (only the keys main.js allows). */
  secrets: {
    status: () => ipcRenderer.invoke('zern:secret-status'),
    get: (key) => ipcRenderer.invoke('zern:secret-get', key),
    set: (key, value) => ipcRenderer.invoke('zern:secret-set', key, value),
    delete: (key) => ipcRenderer.invoke('zern:secret-delete', key),
  },
  onWindowState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('zern:window-state', handler);
    return () => ipcRenderer.removeListener('zern:window-state', handler);
  },
});

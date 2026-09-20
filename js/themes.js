// ============================================================
// themes.js - Central registry of available themes.
// Each theme defines: the key used in data-theme (CSS), the
// name of its associated Monaco theme, and whether it's dark
// or light (for any auxiliary logic that depends on it).
// ============================================================

export const THEMES = {
  'dark-2026': { label: 'Dark 2026 (VS Code 2026)', monaco: 'vscode-dark-2026', dark: true, swatch: ['#121314', '#191a1b', '#0078d4', '#a5d6ff'] },
  'dark-modern': { label: 'Dark Modern', monaco: 'vscode-dark-modern', dark: true, swatch: ['#1f1f1f', '#181818', '#0078d4', '#ce9178'] },
  'dark-plus': { label: 'Dark+ (Classic)', monaco: 'vscode-dark-plus', dark: true, swatch: ['#1e1e1e', '#333333', '#007acc', '#ce9178'] },
  'light-modern': { label: 'Light Modern', monaco: 'vscode-light-modern', dark: false, swatch: ['#ffffff', '#f8f8f8', '#0078d4', '#a31515'] },
  'light-plus': { label: 'Light+ (Classic)', monaco: 'vscode-light-plus', dark: false, swatch: ['#ffffff', '#2c2c2c', '#007acc', '#a31515'] },
  'monokai': { label: 'Monokai', monaco: 'monokai', dark: true, swatch: ['#272822', '#1e1f1c', '#a6e22e', '#e6db74'] },
  'purple': { label: 'Purple (Soft)', monaco: 'vscode-purple', dark: true, swatch: ['#1e1729', '#1a1523', '#a78bfa', '#f0abfc'] },
};

export const THEME_ORDER = ['dark-2026', 'dark-modern', 'dark-plus', 'light-modern', 'light-plus', 'monokai', 'purple'];

export const DEFAULT_THEME = 'dark-2026';

/**
 * Resolves which theme key to use on startup, migrating old
 * configs that only had the `darkTheme` boolean.
 */
export function resolveInitialTheme(config) {
  if (config.theme && THEMES[config.theme]) return config.theme;
  if (config.darkTheme === false) return 'light-plus';
  return DEFAULT_THEME;
}

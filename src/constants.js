// Single runtime source of truth for the app's display name.
// Keep `productName` in package.json in sync (electron-builder uses it for .app/.dmg names at build time).
export const APP_NAME = 'Shockwave';

export const FILE_ACTIONS = Object.freeze({
  NEW_TAB: 'newTab',
  DUPLICATE: 'duplicate',
  REVEAL: 'reveal',
  RENAME: 'rename',
  DELETE: 'delete',
});

export const SETTINGS_SECTIONS = Object.freeze({
  WORKSPACES: 'workspaces',
  APPEARANCE: 'appearance',
});

export const THEME_MODES = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
});

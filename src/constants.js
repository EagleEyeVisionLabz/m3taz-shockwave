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

// Keep in sync with electron/main.js FOLDER_ACTIONS.
export const FOLDER_ACTIONS = Object.freeze({
  NEW_FILE: 'newFile',
  NEW_FOLDER: 'newFolder',
  REVEAL: 'reveal',
  RENAME: 'rename',
  DELETE: 'delete',
});

// Keep in sync with electron/main.js EDITOR_ACTIONS.
export const EDITOR_ACTIONS = Object.freeze({
  ADD_LINK: 'addLink',
  ADD_EXTERNAL_LINK: 'addExternalLink',
  EDIT_EXTERNAL_LINK: 'editExternalLink',
  REMOVE_EXTERNAL_LINK: 'removeExternalLink',
  SEND_TO_AGENT: 'sendToAgent',
});

export const SETTINGS_SECTIONS = Object.freeze({
  APPEARANCE: 'appearance',
  WORKSPACES: 'workspaces',
  AGENT_LLM: 'agent-llm',
  AGENT_SKILLS: 'agent-skills',
  AGENT_WORKSPACE_SKILLS: 'agent-workspace-skills',
  AGENT_SECRETS: 'agent-secrets',
});

export const AI_PROVIDERS = Object.freeze({
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
});

export const THEME_MODES = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
});

// Editor live-preview mode. 'live' renders headings, wiki-link widgets, image
// embeds, task checkboxes, etc. 'raw' shows the underlying markdown text only.
export const VIEW_MODES = Object.freeze({
  LIVE: 'live',
  RAW: 'raw',
});

// Status of the in-flight save lifecycle, surfaced on the editor status bar.
export const SAVE_STATES = Object.freeze({
  SAVED: 'saved',
  UNSAVED: 'unsaved',
});

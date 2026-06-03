// The persisted settings schema — the single typed source of truth shared by
// main (DEFAULT_SETTINGS / readSettings) and the renderer (settingsRef). Until
// those files are TypeScript this type isn't enforced against them at build
// time, but it's the contract: keep DEFAULT_SETTINGS in main.js in sync, and
// any .ts consumer (e.g. a future useSettings) is checked against it.

export type ThemeMode = 'system' | 'light' | 'dark';
export type ViewMode = 'live' | 'raw';
export type TreeSortOrder =
  | 'name-asc'
  | 'name-desc'
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc';

export interface WorkspaceEntry {
  id: string;
  name: string;
  path: string;
}

export type SkillState = 'enabled' | 'disabled';
export type WorkspaceSkillState = 'inherit' | 'enabled' | 'disabled';

export interface CodingAgentSettings {
  provider: string;
  model: string;
  apiKey: string;
  // OpenAI-compatible endpoint URL (Ollama, LM Studio, vLLM, remote gateways).
  // Empty for built-in providers; set only when provider === 'openai-compatible'.
  baseUrl: string;
  // Optional context-window override (tokens) for openai-compatible models, whose
  // size pi can't know. Built-in providers carry authoritative values, so it's
  // unused there. Empty/undefined → 128000 default.
  contextWindow?: number;
  systemPrompt: string;
  skills: {
    // Bundled built-in skills. Absent key ⇒ enabled (default-on). Read-only set.
    builtin: Record<string, SkillState>;
    // User-imported global skills. Absent key ⇒ disabled.
    global: Record<string, SkillState>;
    // Per-workspace overrides over either scope, keyed by folder name.
    workspaces: Record<string, Record<string, WorkspaceSkillState>>;
  };
}

export interface AgentSecret {
  name: string;
  description: string;
  token: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Settings {
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string | null;
  appearance: { themeMode: ThemeMode; hideLineNumbers: boolean; dailyNotesInBookmarks: boolean };
  // `templatePath` is the workspace-relative path of the template seeded into a
  // newly-created daily note ('' = none).
  dailyNote: { format: string; folder: string; templatePath: string };
  // Template files: `folder` is the workspace-relative folder whose `.md` files
  // are offered as templates ('' = templates disabled / none configured).
  templates: { folder: string };
  codingAgent: CodingAgentSettings;
  agentSecrets: AgentSecret[];
  transcription: { provider: string; apiKey: string };
  sync: { pat: string; pullIntervalSeconds: number; disabledWorkspaceIds: string[] };
  chatSidebarOpen: boolean;
  chatSidebarWidth: number;
  sidebarWidth: number;
  viewMode: ViewMode;
  treeSortOrder: TreeSortOrder;
  // Whether the file-tree is filtered to bookmarks only. Persisted globally so
  // the view survives restarts and workspace switches.
  bookmarkFilterActive: boolean;
  windowBounds: WindowBounds | null;
}

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import FileTree from './FileTree.jsx';
import Editor from './Editor.jsx';
import BacklinksPanel from './BacklinksPanel.jsx';
import GraphView from './GraphView.jsx';
import TabStrip from './TabStrip.jsx';
import EditorTitle from './EditorTitle.jsx';
import EditorNav from './EditorNav.jsx';
import ThinSidebar from './ThinSidebar.jsx';
import WorkspaceSelector from './WorkspaceSelector.jsx';
import SettingsModal from './SettingsModal.jsx';
import UrlPromptModal from './UrlPromptModal.jsx';
import ErrorMessage from './ErrorMessage.jsx';
import EditorStatusBar from './EditorStatusBar.jsx';
import ChatSidebar from './ChatSidebar.jsx';
import Dialog from './Dialog.jsx';
import { diffWordsWithSpace } from 'diff';
import { rangesAddedFromDiff } from './diffFlash.js';
import { prettyName } from './linkIndex.js';
import { rewriteReferences } from './renameOps.js';
import { SETTINGS_SECTIONS, THEME_MODES, APP_NAME, FOLDER_ACTIONS, AI_PROVIDERS, VIEW_MODES, SAVE_STATES } from './constants.js';
import { useLinkIndex } from './hooks/useLinkIndex.js';
import { useTabs } from './hooks/useTabs.js';
import { useFileOps } from './hooks/useFileOps.js';

const SAVE_DEBOUNCE_MS = 500;

function genWorkspaceId() {
  return 'ws_' + Math.random().toString(36).slice(2, 10);
}

function basenameOf(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

function flattenAll(nodes, out = []) {
  for (const n of nodes) {
    if (n.children) flattenAll(n.children, out);
    out.push(n);
  }
  return out;
}

// Workspace-wide, case-insensitive .md basename collision check. The link
// index is keyed by basename, so two files sharing a name (in any folder)
// collapse into one and break references. This drives the live title-input
// warning. The IPC handlers auto-disambiguate if the user submits anyway.
function findNameConflict({ tree, currentPath, newName }) {
  const clean = newName.replace(/\.md$/i, '').toLowerCase().trim();
  if (!clean) return null;
  for (const node of flattenAll(tree)) {
    if (node.children) continue;
    if (node.id === currentPath) continue;
    if (!node.name.toLowerCase().endsWith('.md')) continue;
    if (node.name.slice(0, -3).toLowerCase() === clean) return node.id;
  }
  return null;
}

export default function App() {
  // ---- top-level state ----
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [tree, setTree] = useState([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState(null);
  const [graphMode, setGraphMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState(SETTINGS_SECTIONS.WORKSPACES);
  // When set, renders <UrlPromptModal>. The function is the awaiting promise's resolver.
  const [urlPromptResolve, setUrlPromptResolve] = useState(null);
  const [themeMode, setThemeMode] = useState(THEME_MODES.SYSTEM);
  const [hideLineNumbers, setHideLineNumbers] = useState(false);
  const hideLineNumbersRef = useRef(false);
  useEffect(() => { hideLineNumbersRef.current = hideLineNumbers; }, [hideLineNumbers]);
  const [codingAgentSettings, setCodingAgentSettings] = useState({
    provider: AI_PROVIDERS.ANTHROPIC,
    model: 'claude-sonnet-4-5',
    apiKey: '',
    skills: { global: {}, workspaces: {} },
  });
  const codingAgentSettingsRef = useRef(codingAgentSettings);
  useEffect(() => { codingAgentSettingsRef.current = codingAgentSettings; }, [codingAgentSettings]);
  // Global agent secrets — list of { name, description, token, createdAt, updatedAt }.
  // Tokens come from main already decrypted; persisted via the standard settings flow.
  const [agentSecrets, setAgentSecrets] = useState([]);
  const agentSecretsRef = useRef(agentSecrets);
  useEffect(() => { agentSecretsRef.current = agentSecrets; }, [agentSecrets]);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const sidebarWidthRef = useRef(260);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const chatSidebarOpenRef = useRef(false);
  const [chatSidebarWidth, setChatSidebarWidth] = useState(360);
  const chatSidebarWidthRef = useRef(360);
  const [viewMode, setViewMode] = useState(VIEW_MODES.LIVE);
  const [editorStats, setEditorStats] = useState({ words: 0, chars: 0 });
  const [saveState, setSaveState] = useState(SAVE_STATES.SAVED);
  // Pending "Send to Agent" payload waiting on the Replace/Append decision.
  // Non-null only while the collision dialog is open.
  const [sendToAgentPending, setSendToAgentPending] = useState(null);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null;
  const workspacePath = activeWorkspace?.path ?? null;
  const workspacePathRef = useRef(workspacePath);
  useEffect(() => { workspacePathRef.current = workspacePath; }, [workspacePath]);

  // Live ref to the active file's absolute path. Used by the editor's image
  // paste/drop handler (target dir for the saved image) and the inline image
  // renderer (base for resolving relative URLs). Null for drafts.
  const activeFilePathRef = useRef(null);

  // ---- app title ----
  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  // ---- effective theme ----
  const effectiveTheme = useMemo(() => {
    if (themeMode === THEME_MODES.SYSTEM) return systemPrefersDark ? 'dark' : 'light';
    return themeMode;
  }, [themeMode, systemPrefersDark]);
  const isDark = effectiveTheme === 'dark';
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  // ---- error helper ----
  const showError = useCallback((msg) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 4000);
  }, []);

  // ---- editor ref ----
  const editorRef = useRef(null);
  // ---- file tree ref (imperative API: editNode(id)) ----
  const fileTreeRef = useRef(null);
  // ---- chat sidebar ref (imperative API: setComposerText, getComposerText, focusComposer) ----
  // Use a callback ref + ready flag so the "Send to Agent" pending injection
  // effect re-runs when ChatSidebar mounts (sidebar was previously collapsed).
  const chatSidebarRef = useRef(null);
  const [chatSidebarReady, setChatSidebarReady] = useState(false);
  const setChatSidebarRef = useCallback((handle) => {
    chatSidebarRef.current = handle;
    setChatSidebarReady(!!handle);
  }, []);
  // { text, append } waiting for the sidebar's imperative ref to attach.
  const [pendingComposerInjection, setPendingComposerInjection] = useState(null);

  // ---- save lifecycle (stays in App, crosses concerns) ----
  const dirtyPathRef = useRef(null);
  const saveTimerRef = useRef(null);

  const linkIndex = useLinkIndex(tree);

  const writeNow = useCallback(async () => {
    const path = dirtyPathRef.current;
    if (!path) return;
    dirtyPathRef.current = null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const text = editor.getText();
    await window.api.writeFile(path, text);
    linkIndex.updateFile(path, text);
    // Only flip to "saved" if nothing else dirtied the path while we were writing.
    if (dirtyPathRef.current === null) setSaveState(SAVE_STATES.SAVED);
  }, [linkIndex]);

  // ---- tabs (drafts live here) ----
  const onAfterSwitch = useCallback(() => {
    if (graphMode) setGraphMode(false);
  }, [graphMode]);

  const tabsApi = useTabs({ editorRef, writeNow, onAfterSwitch });
  const { activeFile, activeIsDraft, activeTab, openInActiveTab, openInNewTab, addDraftTab,
          switchTab, closeTab, closeTabsForPath, closeTabsUnderPath, renameTabsPath, resetTabs,
          promoteDraft, tabs, activeTabId, goBack, goForward, canGoBack, canGoForward } = tabsApi;

  useEffect(() => {
    activeFilePathRef.current = activeIsDraft ? null : activeFile;
  }, [activeFile, activeIsDraft]);

  const onBack = useCallback(() => { if (activeTabId) goBack(activeTabId); }, [activeTabId, goBack]);
  const onForward = useCallback(() => { if (activeTabId) goForward(activeTabId); }, [activeTabId, goForward]);

  // Where a new file should be created when promoting a draft.
  // Priority: explicitly selected folder → dir of the active file → vault root.
  const newFileDir = useCallback(() => {
    if (selectedFolderPath) return selectedFolderPath;
    if (activeFile) return dirOf(activeFile);
    return workspacePath;
  }, [selectedFolderPath, activeFile, workspacePath]);

  // Resolve an absolute file path for write-side image operations. If the
  // active tab is a draft, promote it on the spot (same flow as the keystroke
  // promotion in onEditorChange) so the dropped image has a real folder to
  // land in. Returns null when there's no active tab.
  const ensureActiveFilePath = useCallback(async () => {
    if (!activeTab) return null;
    if (!activeTab.isDraft) return activeFile;
    const editor = editorRef.current;
    const currentText = editor?.getText() ?? '';
    const newPath = await promoteDraft(activeTab.id, newFileDir(), {
      name: titleDraft || 'Untitled',
      initialContent: '',
    });
    linkIndex.updateFile(newPath, currentText);
    // Mark dirty so the buffer (which may have unsaved typing alongside the
    // image drop) gets flushed by the next writeNow tick.
    dirtyPathRef.current = newPath;
    return newPath;
  }, [activeTab, activeFile, promoteDraft, newFileDir, titleDraft, linkIndex]);
  const ensureActiveFilePathRef = useRef(ensureActiveFilePath);
  useEffect(() => { ensureActiveFilePathRef.current = ensureActiveFilePath; }, [ensureActiveFilePath]);

  // ---- on editor change: schedule debounced save; promote drafts ----
  const onEditorChange = useCallback(() => {
    if (!activeTab) return;
    setSaveState(SAVE_STATES.UNSAVED);
    if (activeTab.isDraft) {
      // Promote then schedule a save against the new path.
      (async () => {
        try {
          const editor = editorRef.current;
          const currentText = editor?.getText() ?? '';
          const newPath = await promoteDraft(activeTab.id, newFileDir(), {
            name: titleDraft || 'Untitled',
            initialContent: '',
          });
          linkIndex.updateFile(newPath, currentText);
          dirtyPathRef.current = newPath;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => writeNow(), SAVE_DEBOUNCE_MS);
        } catch (err) {
          showError(err.message ?? String(err));
        }
      })();
      return;
    }
    dirtyPathRef.current = activeFile;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => writeNow(), SAVE_DEBOUNCE_MS);
  }, [activeTab, activeFile, writeNow, promoteDraft, newFileDir, titleDraft, linkIndex, showError]);

  // ---- refresh tree ----
  const refreshTree = useCallback(async () => {
    if (!workspacePath) return [];
    const data = await window.api.readTree(workspacePath);
    setTree(data);
    return data;
  }, [workspacePath]);

  // ---- file operations ----
  const fileOps = useFileOps({
    workspacePath,
    pageIndex: linkIndex.pageIndex,
    linkIndex,
    tabs,
    writeNow,
    openInActiveTab,
    openInNewTab,
    closeTabsForPath,
    renameTabsPath,
    showError,
    refreshTree,
  });

  // ---- tree selection ----
  // Folders set selectedFolderPath (used as target dir for new files).
  // Files clear it and open in the active tab.
  const onSelect = useCallback(async (nodes) => {
    const node = nodes[0];
    if (!node) return;
    if (node.children) {
      setSelectedFolderPath(node.id);
      return;
    }
    setSelectedFolderPath(null);
    if (!node.data.name.toLowerCase().endsWith('.md')) return;
    if (graphMode) setGraphMode(false);
    await openInActiveTab(node.id);
  }, [openInActiveTab, graphMode]);

  // ---- workspace operations ----
  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  const persistSettings = useCallback(async (next) => {
    await window.api.settings.write({
      workspaces: next.workspaces,
      activeWorkspaceId: next.activeWorkspaceId,
      appearance: {
        themeMode: next.themeMode,
        hideLineNumbers: next.hideLineNumbers ?? hideLineNumbersRef.current,
      },
      codingAgent: next.codingAgent ?? codingAgentSettingsRef.current,
      agentSecrets: next.agentSecrets ?? agentSecretsRef.current,
      sidebarWidth: next.sidebarWidth ?? sidebarWidthRef.current,
      viewMode: next.viewMode ?? viewModeRef.current,
      chatSidebarOpen: next.chatSidebarOpen ?? chatSidebarOpenRef.current,
      chatSidebarWidth: next.chatSidebarWidth ?? chatSidebarWidthRef.current,
    });
  }, []);

  const persistSidebarWidth = useCallback(async (width) => {
    sidebarWidthRef.current = width;
    await persistSettings({ workspaces, activeWorkspaceId, themeMode, sidebarWidth: width });
  }, [persistSettings, workspaces, activeWorkspaceId, themeMode]);

  const loadWorkspace = useCallback(async (workspace) => {
    await writeNow();
    await window.api.watchStop();
    resetTabs();
    setTree([]);
    setSelectedFolderPath(null);
    setGraphMode(false);
    setSaveState(SAVE_STATES.SAVED);
    const [treeData, files] = await Promise.all([
      window.api.readTree(workspace.path),
      window.api.readAllMarkdown(workspace.path),
    ]);
    setTree(treeData);
    linkIndex.rebuild(files);
    await window.api.watchStart(workspace.path);
  }, [writeNow, resetTabs, linkIndex]);

  const switchWorkspace = useCallback(async (id) => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;
    const exists = await window.api.pathExists(ws.path);
    if (!exists) {
      const removed = workspaces.filter((w) => w.id !== id);
      setWorkspaces(removed);
      setActiveWorkspaceId(null);
      await persistSettings({ workspaces: removed, activeWorkspaceId: null, themeMode });
      showError(`Workspace "${ws.name}" no longer exists.`);
      return;
    }
    setActiveWorkspaceId(id);
    await persistSettings({ workspaces, activeWorkspaceId: id, themeMode });
    await loadWorkspace(ws);
  }, [workspaces, persistSettings, themeMode, loadWorkspace, showError]);

  const addWorkspace = useCallback(async () => {
    const folder = await window.api.openFolder();
    if (!folder) return;
    const existing = workspaces.find((w) => w.path === folder);
    if (existing) {
      await switchWorkspace(existing.id);
      return;
    }
    const ws = { id: genWorkspaceId(), name: basenameOf(folder), path: folder };
    const next = [...workspaces, ws];
    setWorkspaces(next);
    setActiveWorkspaceId(ws.id);
    await persistSettings({ workspaces: next, activeWorkspaceId: ws.id, themeMode });
    await loadWorkspace(ws);
  }, [workspaces, persistSettings, themeMode, loadWorkspace, switchWorkspace]);

  const removeWorkspace = useCallback(async (id) => {
    const next = workspaces.filter((w) => w.id !== id);
    setWorkspaces(next);
    let newActive = activeWorkspaceId;
    if (id === activeWorkspaceId) {
      newActive = null;
      setActiveWorkspaceId(null);
      resetTabs();
      setTree([]);
      setSelectedFolderPath(null);
      await window.api.watchStop();
    }
    await persistSettings({ workspaces: next, activeWorkspaceId: newActive, themeMode });
  }, [workspaces, activeWorkspaceId, persistSettings, themeMode, resetTabs]);

  const onThemeModeChange = useCallback(async (mode) => {
    setThemeMode(mode);
    await persistSettings({ workspaces, activeWorkspaceId, themeMode: mode });
  }, [persistSettings, workspaces, activeWorkspaceId]);

  const onHideLineNumbersChange = useCallback(async (next) => {
    setHideLineNumbers(next);
    hideLineNumbersRef.current = next;
    await persistSettings({ workspaces, activeWorkspaceId, themeMode, hideLineNumbers: next });
  }, [persistSettings, workspaces, activeWorkspaceId, themeMode]);

  const onToggleViewMode = useCallback(async () => {
    const next = viewMode === VIEW_MODES.LIVE ? VIEW_MODES.RAW : VIEW_MODES.LIVE;
    setViewMode(next);
    await persistSettings({ workspaces, activeWorkspaceId, themeMode, viewMode: next });
  }, [viewMode, persistSettings, workspaces, activeWorkspaceId, themeMode]);

  const onCodingAgentChange = useCallback(async (next) => {
    setCodingAgentSettings(next);
    codingAgentSettingsRef.current = next;
    await persistSettings({ workspaces, activeWorkspaceId, themeMode, codingAgent: next });
  }, [persistSettings, workspaces, activeWorkspaceId, themeMode]);

  const onAgentSecretsChange = useCallback(async (next) => {
    setAgentSecrets(next);
    agentSecretsRef.current = next;
    await persistSettings({ workspaces, activeWorkspaceId, themeMode, agentSecrets: next });
  }, [persistSettings, workspaces, activeWorkspaceId, themeMode]);

  // ---- title commit (rename existing or promote draft) ----
  const onTitleCommit = useCallback(async (newName) => {
    if (!activeTab) return;
    if (activeTab.isDraft) {
      try {
        const editor = editorRef.current;
        const text = editor?.getText() ?? '';
        const newPath = await promoteDraft(activeTab.id, newFileDir(), {
          name: newName,
          initialContent: text,
        });
        linkIndex.updateFile(newPath, text);
        await fileOps.treeAndIndexChanged();
      } catch (err) {
        showError(err.message ?? String(err));
      }
      return;
    }
    if (!activeFile) return;
    await fileOps.performRename(activeFile, newName);
  }, [activeTab, activeFile, newFileDir, linkIndex, promoteDraft, fileOps, showError]);

  // ---- graph toggle ----
  const onToggleGraph = useCallback(async () => {
    await writeNow();
    setGraphMode((g) => !g);
  }, [writeNow]);

  // ---- new file (thin sidebar) ----
  const onNewFile = useCallback(async () => {
    if (!workspacePath) return;
    await addDraftTab();
  }, [workspacePath, addDraftTab]);

  // ---- create a folder + put it into rename mode ----
  const createFolderAt = useCallback(async (dirPath) => {
    try {
      const newPath = await window.api.createFolder(dirPath, 'New folder');
      await fileOps.treeAndIndexChanged();
      fileTreeRef.current?.editNode(newPath);
    } catch (err) {
      showError(err.message ?? String(err));
    }
  }, [fileOps, showError]);

  // ---- folder context-menu actions (right-click on a tree folder) ----
  const onFolderAction = useCallback(async (action, folderPath) => {
    try {
      if (action === FOLDER_ACTIONS.NEW_FILE) {
        setSelectedFolderPath(folderPath);
        await addDraftTab();
      } else if (action === FOLDER_ACTIONS.NEW_FOLDER) {
        await createFolderAt(folderPath);
      } else if (action === FOLDER_ACTIONS.REVEAL) {
        await window.api.revealInFolder(folderPath);
      } else if (action === FOLDER_ACTIONS.RENAME) {
        fileTreeRef.current?.editNode(folderPath);
      } else if (action === FOLDER_ACTIONS.DELETE) {
        const confirmed = await window.api.trashFolder(folderPath);
        if (!confirmed) return;
        // Sweep up any link-index entries inside the trashed folder so
        // backlinks/graph drop them immediately (don't wait for the watcher).
        const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
        const outgoing = linkIndex.linkIndexRef.current.getOutgoingMap();
        const affected = [];
        for (const p of outgoing.keys()) {
          if (p.startsWith(prefix)) affected.push(p);
        }
        for (const p of affected) linkIndex.linkIndexRef.current.removeFile(p);
        closeTabsUnderPath(folderPath);
        // Clear the selected folder if it's the one we just trashed.
        if (selectedFolderPath && (selectedFolderPath === folderPath || selectedFolderPath.startsWith(prefix))) {
          setSelectedFolderPath(null);
        }
        await fileOps.treeAndIndexChanged();
      }
    } catch (err) {
      showError(err.message ?? String(err));
    }
  }, [addDraftTab, createFolderAt, closeTabsUnderPath, fileOps, linkIndex, selectedFolderPath, showError]);

  // ---- new folder from thin sidebar (root level, or current selected folder) ----
  const onNewFolder = useCallback(async () => {
    if (!workspacePath) return;
    const dir = selectedFolderPath || workspacePath;
    await createFolderAt(dir);
  }, [workspacePath, selectedFolderPath, createFolderAt]);

  // ---- handle drag-and-drop moves from the tree ----
  // dragIds = list of source paths (files or folders). destFolderId is the destination
  // folder's path, or null for the workspace root.
  const onMoveItems = useCallback(async (dragIds, destFolderId) => {
    const destDir = destFolderId ?? workspacePath;
    if (!destDir) return;
    const affectedRenames = []; // [{oldPath, newPath}] for FILES (immediate + nested)

    for (const src of dragIds) {
      try {
        // No-op: dropping into the current parent.
        if (dirOf(src) === destDir) continue;
        // No-op: dropping a folder onto itself.
        if (src === destDir) continue;
        // Capture every linkIndex entry currently under this src (files + folder contents).
        const outgoing = linkIndex.linkIndexRef.current.getOutgoingMap();
        const insideSrc = [];
        const srcAsDir = src.endsWith('/') ? src : src + '/';
        for (const p of outgoing.keys()) {
          if (p === src || p.startsWith(srcAsDir)) insideSrc.push(p);
        }

        const newPath = await window.api.moveItem(src, destDir);
        const newAsDir = newPath.endsWith('/') ? newPath : newPath + '/';

        // For folders: the folder rename causes every nested .md path to change.
        // For files: insideSrc contains just the file itself (if it was in the index).
        for (const oldP of insideSrc) {
          const suffix = oldP === src ? '' : oldP.slice(srcAsDir.length);
          const newP = suffix ? (newAsDir + suffix) : newPath;
          linkIndex.linkIndexRef.current.renameFile(oldP, newP);
          renameTabsPath(oldP, newP);
          affectedRenames.push({ oldPath: oldP, newPath: newP });
        }

        // Selected folder might have moved — track it.
        if (selectedFolderPath === src) setSelectedFolderPath(newPath);
        else if (selectedFolderPath && selectedFolderPath.startsWith(srcAsDir)) {
          setSelectedFolderPath(newAsDir + selectedFolderPath.slice(srcAsDir.length));
        }
      } catch (err) {
        showError(err.message ?? String(err));
      }
    }

    if (affectedRenames.length > 0 || dragIds.length > 0) {
      await fileOps.treeAndIndexChanged();
    }
  }, [workspacePath, linkIndex, renameTabsPath, fileOps, selectedFolderPath, showError]);

  // Disallow dropping ONTO a leaf node (you can only drop into folders).
  const disableDrop = useCallback(({ parentNode }) => {
    if (!parentNode) return false; // root drop is fine
    return !parentNode.isInternal;
  }, []);

  // ---- handle rename commits from the tree (files OR folders) ----
  //
  // Folder renames change every nested file's path. We re-key the link index
  // and any open tabs synchronously to keep them in sync — same shape as the
  // drag-and-drop move handler (onMoveItems above). Without this, the index
  // would carry stale path keys until the watcher echoed unlink+add for
  // every nested file, and any open tab inside the renamed folder would
  // point at a nonexistent path.
  const onTreeRename = useCallback(async ({ id, name }) => {
    const isFolder = !id.toLowerCase().endsWith('.md');
    if (isFolder) {
      try {
        // Capture nested .md paths from the index BEFORE renaming.
        const outgoing = linkIndex.linkIndexRef.current.getOutgoingMap();
        const srcAsDir = id.endsWith('/') ? id : id + '/';
        const insideSrc = [];
        for (const p of outgoing.keys()) {
          if (p === id || p.startsWith(srcAsDir)) insideSrc.push(p);
        }
        // Flush any pending edits before the rename invalidates the path.
        await writeNow();
        const newFolderPath = await window.api.renameFolder(id, name);
        const newAsDir = newFolderPath.endsWith('/') ? newFolderPath : newFolderPath + '/';
        for (const oldP of insideSrc) {
          const suffix = oldP === id ? '' : oldP.slice(srcAsDir.length);
          const newP = suffix ? (newAsDir + suffix) : newFolderPath;
          linkIndex.linkIndexRef.current.renameFile(oldP, newP);
          renameTabsPath(oldP, newP);
        }
        if (selectedFolderPath === id) setSelectedFolderPath(newFolderPath);
        else if (selectedFolderPath && selectedFolderPath.startsWith(srcAsDir)) {
          setSelectedFolderPath(newAsDir + selectedFolderPath.slice(srcAsDir.length));
        }
        await fileOps.treeAndIndexChanged();
      } catch (err) {
        showError(err.message ?? String(err));
      }
      return;
    }
    return fileOps.performRename(id, name);
  }, [fileOps, linkIndex, renameTabsPath, selectedFolderPath, showError, writeNow]);

  // ---- URL prompt (used by editor "Add external link") ----
  const requestUrl = useCallback(() => {
    return new Promise((resolve) => {
      // Wrap the resolver so React's setState doesn't try to invoke it.
      setUrlPromptResolve(() => resolve);
    });
  }, []);

  const handleUrlSubmit = useCallback((url) => {
    setUrlPromptResolve((prev) => { prev?.(url); return null; });
  }, []);

  const handleUrlCancel = useCallback(() => {
    setUrlPromptResolve((prev) => { prev?.(null); return null; });
  }, []);

  // ---- settings open helpers ----
  // Pass an explicit section to land on a specific page; omit to defer to the modal's
  // topmost section (whatever it currently is).
  const openSettings = useCallback((section) => {
    setSettingsInitialSection(section ?? null);
    setSettingsOpen(true);
  }, []);

  // ---- beforeunload save ----
  useEffect(() => {
    const flush = () => { writeNow(); };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [writeNow]);

  // ---- external file change subscription ----
  //
  // Watcher events fall into four buckets:
  //   - {type:'add'|'change', path, mtime, outgoingLinks}             — .md file appeared or modified
  //   - {type:'unlink', path}                                          — .md file removed
  //   - {type:'rename', oldPath, newPath, mtime, outgoingLinks}        — paired by the correlator (inode+hash)
  //   - {type:'tree'}                                                  — folder change / non-.md (tree refresh only)
  //
  // The 'rename' event lets external renames (Finder, `mv`, agents, git checkout)
  // rewrite references the same way in-app renames do — without it, refs in
  // other files would break silently when something moves outside the app.
  //
  // Self-echo guard: every renderer-initiated write triggers a watcher event ~350ms
  // later. The renderer has already called linkIndex.updateFile with a Date.now()
  // mtime, so the echo's stat.mtimeMs will be <= the stored mtime. We compare and
  // skip stale events so the echo can't clobber fresh in-memory state.
  // Stable refs so the watcher subscription below depends ONLY on workspacePath
  // and never tears down on re-render. Critical: `linkIndex.bump()` (called by
  // `applyParsedLinks` / `removeFile` / `renameFile`) triggers a re-render; if
  // this effect re-ran on that, the 80ms `refreshTimer` set inside the listener
  // would be cleared by cleanup before it could fire, and the tree would never
  // refresh for external .md adds. See the deep dive on the file-watcher
  // gotcha in CLAUDE.md → Development workflow.
  const linkIndexRefForWatcher = useRef(linkIndex);
  useEffect(() => { linkIndexRefForWatcher.current = linkIndex; }, [linkIndex]);
  const refreshTreeRef = useRef(refreshTree);
  useEffect(() => { refreshTreeRef.current = refreshTree; }, [refreshTree]);
  const renameTabsPathRef = useRef(renameTabsPath);
  useEffect(() => { renameTabsPathRef.current = renameTabsPath; }, [renameTabsPath]);
  const showErrorRef = useRef(showError);
  useEffect(() => { showErrorRef.current = showError; }, [showError]);
  // Watcher reads activeFile via this ref so the subscription doesn't retear
  // every time the user switches tabs.
  const activeFileRef = useRef(activeFile);
  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);
  const activeIsDraftRef = useRef(activeIsDraft);
  useEffect(() => { activeIsDraftRef.current = activeIsDraft; }, [activeIsDraft]);

  useEffect(() => {
    if (!workspacePath) return undefined;
    let refreshTimer = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshTreeRef.current();
      }, 80);
    };
    const unsub = window.api.onFsChanged((evt) => {
      const li = linkIndexRefForWatcher.current;
      if (evt.type === 'tree') {
        scheduleRefresh();
        return;
      }
      if (evt.type === 'unlink') {
        li.removeFile(evt.path);
        scheduleRefresh();
        return;
      }
      if (evt.type === 'rename') {
        // 1) Re-key the index so subsequent events for newPath are coherent.
        li.renameFile(evt.oldPath, evt.newPath);
        // 2) Refresh outgoing links if content changed during the move (rare).
        const stored = li.linkIndexRef.current.getMtime(evt.newPath);
        if (stored == null || evt.mtime > stored) {
          li.applyParsedLinks(evt.newPath, evt.outgoingLinks, evt.mtime);
        }
        // 3) Update any open tabs pointing at the old path.
        renameTabsPathRef.current(evt.oldPath, evt.newPath);
        // 4) Rewrite `[[OldName]]` references in other files. Idempotent — if
        //    the rename was in-app, these were already rewritten and the regex
        //    matches nothing on the watcher echo.
        const oldBaseName = evt.oldPath.split('/').pop().replace(/\.md$/i, '');
        const newBaseName = evt.newPath.split('/').pop().replace(/\.md$/i, '');
        if (oldBaseName !== newBaseName) {
          (async () => {
            try {
              await rewriteReferences({
                api: window.api,
                linkIndex: li.linkIndexRef.current,
                oldBaseName,
                newBaseName,
                selfPath: evt.newPath,
              });
              // Re-read self in case self-refs were rewritten on disk.
              try {
                const content = await window.api.readFile(evt.newPath);
                li.updateFile(evt.newPath, content);
              } catch { /* file may have moved again */ }
            } catch (err) {
              showErrorRef.current(err.message ?? String(err));
            }
          })();
        }
        scheduleRefresh();
        return;
      }
      // 'add' | 'change'
      const stored = li.linkIndexRef.current.getMtime(evt.path);
      const isFresh = stored == null || evt.mtime > stored;
      if (isFresh) {
        li.applyParsedLinks(evt.path, evt.outgoingLinks, evt.mtime);
      }
      // If the changed file is the open tab, reload the buffer from disk and
      // flash the added text green. Skipping the freshness check here means a
      // self-echo (renderer just wrote) is ignored — the stored mtime gate
      // above already filtered for that.
      if (
        evt.type === 'change' &&
        isFresh &&
        evt.path === activeFileRef.current &&
        !activeIsDraftRef.current
      ) {
        (async () => {
          try {
            const editor = editorRef.current;
            if (!editor) return;
            const oldText = editor.getText();
            const newText = await window.api.readFile(evt.path);
            if (oldText === newText) return;
            const viewState = editor.getViewState();
            editor.setContent(newText, viewState);
            const changes = diffWordsWithSpace(oldText, newText);
            const ranges = rangesAddedFromDiff(changes);
            if (ranges.length > 0) editor.flashRanges(ranges);
          } catch (err) {
            // File may have been deleted or moved before we could read it.
          }
        })();
      }
      if (evt.type === 'add') scheduleRefresh();
    });
    return () => {
      unsub();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [workspacePath]);

  // ---- boot: load settings + subscribe to system theme ----
  useEffect(() => {
    let active = true;
    let unsubscribe;
    (async () => {
      const [settings, initialTheme] = await Promise.all([
        window.api.settings.read(),
        window.api.theme.getInitial(),
      ]);
      if (!active) return;
      setSystemPrefersDark(!!initialTheme.dark);
      setThemeMode(settings.appearance?.themeMode || THEME_MODES.SYSTEM);
      const hide = !!settings.appearance?.hideLineNumbers;
      setHideLineNumbers(hide);
      hideLineNumbersRef.current = hide;
      setWorkspaces(settings.workspaces || []);
      if (settings.codingAgent) {
        setCodingAgentSettings(settings.codingAgent);
        codingAgentSettingsRef.current = settings.codingAgent;
      }
      if (Array.isArray(settings.agentSecrets)) {
        setAgentSecrets(settings.agentSecrets);
        agentSecretsRef.current = settings.agentSecrets;
      }
      if (typeof settings.sidebarWidth === 'number') {
        setSidebarWidth(settings.sidebarWidth);
        sidebarWidthRef.current = settings.sidebarWidth;
      }
      if (typeof settings.chatSidebarOpen === 'boolean') {
        setChatSidebarOpen(settings.chatSidebarOpen);
        chatSidebarOpenRef.current = settings.chatSidebarOpen;
      }
      if (typeof settings.chatSidebarWidth === 'number') {
        setChatSidebarWidth(settings.chatSidebarWidth);
        chatSidebarWidthRef.current = settings.chatSidebarWidth;
      }
      if (settings.viewMode === VIEW_MODES.RAW || settings.viewMode === VIEW_MODES.LIVE) {
        setViewMode(settings.viewMode);
        viewModeRef.current = settings.viewMode;
      }

      const lastId = settings.activeWorkspaceId;
      if (lastId) {
        const ws = (settings.workspaces || []).find((w) => w.id === lastId);
        if (ws) {
          const exists = await window.api.pathExists(ws.path);
          if (exists) {
            setActiveWorkspaceId(lastId);
            await loadWorkspace(ws);
          } else {
            // Drop it from the list and persist.
            const next = (settings.workspaces || []).filter((w) => w.id !== lastId);
            setWorkspaces(next);
            await window.api.settings.write({
              workspaces: next,
              activeWorkspaceId: null,
              appearance: settings.appearance ?? { themeMode: THEME_MODES.SYSTEM },
            });
            showError(`Workspace "${ws.name}" no longer exists at ${ws.path}.`);
          }
        }
      }

      unsubscribe = window.api.theme.onSystemChange(({ dark }) => {
        setSystemPrefersDark(!!dark);
      });
      setBootDone(true);
    })();
    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- effect: load the active file's content into the editor whenever activeFile or draft state changes ----
  useEffect(() => {
    if (!workspacePath) return;
    const editor = editorRef.current;
    if (!editor) return;
    if (activeIsDraft || !activeFile) {
      editor.setContent('', null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const text = await window.api.readFile(activeFile);
        if (cancelled) return;
        const ed = editorRef.current;
        if (!ed) return;
        const vs = tabsApi.viewStateByPath.current.get(activeFile) ?? null;
        ed.setContent(text, vs);
      } catch (err) {
        if (!cancelled) showError(err.message ?? String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [activeFile, activeIsDraft, workspacePath, isDark, tabsApi.viewStateByPath, showError]);

  // ---- backlinks for active file ----
  const activeBacklinks = useMemo(
    () => linkIndex.getBacklinksForFile(activeFile),
    [activeFile, linkIndex],
  );

  // ---- title sync with active file/tab ----
  const titleFromActive = activeIsDraft
    ? ''
    : (activeFile ? prettyName(activeFile).split('/').pop() : '');
  // Layout effect — runs synchronously before paint so the title input never
  // renders with a stale draft against a freshly-switched activeFile (which
  // would briefly trigger a false title-conflict popup).
  useLayoutEffect(() => {
    setTitleDraft(titleFromActive);
  }, [titleFromActive]);

  // ---- title conflict (live validation while typing) ----
  const titleConflict = useMemo(() => {
    if (!workspacePath) return null;
    const draft = (titleDraft || '').trim();
    if (!draft) return null;
    if (!activeIsDraft && draft === titleFromActive) return null;
    return findNameConflict({
      tree,
      currentPath: activeFile,
      newName: draft,
    });
  }, [titleDraft, tree, workspacePath, activeFile, activeIsDraft, titleFromActive]);

  const onSidebarResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;
    const onMove = (ev) => {
      const next = Math.max(180, Math.min(600, startWidth + ev.clientX - startX));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      persistSidebarWidth(sidebarWidthRef.current);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [persistSidebarWidth]);

  const persistChatSidebar = useCallback(async () => {
    await persistSettings({ workspaces, activeWorkspaceId, themeMode });
  }, [persistSettings, workspaces, activeWorkspaceId, themeMode]);

  const toggleChatSidebar = useCallback(() => {
    setChatSidebarOpen((prev) => {
      const next = !prev;
      chatSidebarOpenRef.current = next;
      persistChatSidebar();
      return next;
    });
  }, [persistChatSidebar]);

  // Build the framing snippet that gets dropped into the chat composer when
  // the user picks "Send to Agent" from the editor context menu. Path is
  // workspace-relative; selected text is fenced with ~~~ to avoid colliding
  // with code blocks inside it. Trailing newline puts the caret on a blank
  // line so the user can start typing their request.
  const buildSendToAgentSnippet = useCallback((payload) => {
    if (!workspacePath || !payload?.relPath) return '';
    const { relPath } = payload;
    if (payload.hasSelection) {
      return (
        `I've copied the selected text below from ${relPath} at line ${payload.fromLine}, column ${payload.fromCol} to line ${payload.toLine}, column ${payload.toCol}:\n\n` +
        `~~~\n${payload.selection}\n~~~\n\n`
      );
    }
    return `My cursor is at line ${payload.line}, column ${payload.col} in ${relPath}.\n\n`;
  }, [workspacePath]);

  const applySendToAgent = useCallback((snippet, { append }) => {
    if (!chatSidebarOpenRef.current) {
      chatSidebarOpenRef.current = true;
      setChatSidebarOpen(true);
      persistChatSidebar();
    }
    // Either fires immediately (sidebar already open + ref attached) or once
    // the mount completes and the callback ref flips chatSidebarReady to true.
    setPendingComposerInjection({ text: snippet, append });
  }, [persistChatSidebar]);

  // Drain a pending composer injection once the sidebar's ref is attached.
  useEffect(() => {
    if (!chatSidebarReady || !pendingComposerInjection) return;
    const { text, append } = pendingComposerInjection;
    chatSidebarRef.current?.setComposerText(text, { append });
    requestAnimationFrame(() => chatSidebarRef.current?.focusComposer());
    setPendingComposerInjection(null);
  }, [chatSidebarReady, pendingComposerInjection]);

  const onSendToAgent = useCallback((info) => {
    if (!workspacePath || !activeFile) return;
    // Prefix the workspace-relative path with `[cwd]/` so the agent reads it
    // as "relative to your cwd" (which pi sets to the active workspace). Root
    // files still get the prefix so the snippet shape is uniform.
    let rel = activeFile;
    if (activeFile.startsWith(workspacePath)) {
      rel = activeFile.slice(workspacePath.length).replace(/^\/+/, '');
    }
    const relPath = `[cwd]/${rel}`;
    const snippet = buildSendToAgentSnippet({ ...info, relPath });
    if (!snippet) return;
    // Sidebar closed → composer guaranteed empty (component is unmounted), no
    // need to prompt. Sidebar open → ask before clobbering existing text.
    if (chatSidebarOpenRef.current) {
      const existing = chatSidebarRef.current?.getComposerText?.() ?? '';
      if (existing.trim()) {
        setSendToAgentPending(snippet);
        return;
      }
    }
    applySendToAgent(snippet, { append: false });
  }, [workspacePath, activeFile, buildSendToAgentSnippet, applySendToAgent]);

  const onChatSidebarResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = chatSidebarWidthRef.current;
    const onMove = (ev) => {
      // Chat sidebar is on the right edge, so dragging LEFT (negative delta) widens it.
      const next = Math.max(260, Math.min(720, startWidth - (ev.clientX - startX)));
      chatSidebarWidthRef.current = next;
      setChatSidebarWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      persistChatSidebar();
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [persistChatSidebar]);

  return (
    <div
      className="app"
      style={{
        '--sidebar-width': `${sidebarWidth}px`,
        '--chat-col-width': chatSidebarOpen ? `${chatSidebarWidth}px` : '28px',
      }}
    >
      <ThinSidebar
        onNewFile={onNewFile}
        onNewFolder={onNewFolder}
        onToggleGraph={onToggleGraph}
        graphMode={graphMode}
        disabled={!workspacePath}
      />

      <aside className="sidebar">
        <div className="tree-wrap">
          {tree.length > 0 ? (
            <FileTree
              ref={fileTreeRef}
              data={tree}
              onSelect={onSelect}
              onRename={onTreeRename}
              onFileAction={fileOps.onFileAction}
              onFolderAction={onFolderAction}
              onMoveItems={onMoveItems}
              disableDrop={disableDrop}
            />
          ) : (
            <div className="empty">
              {workspacePath ? 'Empty workspace' : 'No workspace open'}
            </div>
          )}
        </div>
        <WorkspaceSelector
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSwitch={switchWorkspace}
          onManage={() => openSettings(SETTINGS_SECTIONS.WORKSPACES)}
          onOpenSettings={() => openSettings()}
        />
        <div
          className="sidebar-resize-handle"
          onMouseDown={onSidebarResizeStart}
        />
      </aside>

      <main className="editor-pane">
        {workspacePath && (
          <TabStrip
            tabs={tabs}
            activeTabId={activeTabId}
            vaultPath={workspacePath}
            activeOverrideLabel={titleDraft}
            onSwitch={switchTab}
            onClose={closeTab}
            onAdd={addDraftTab}
          />
        )}
        {errorMessage && <div className="app-error">{errorMessage}</div>}

        {graphMode ? (
          <GraphView
            tree={tree}
            pageIndex={linkIndex.pageIndex}
            outgoingByFile={linkIndex.linkIndexRef.current.getOutgoingMap()}
            linkIndexVersion={linkIndex.version}
            dark={isDark}
            onOpenFile={async (id) => {
              setGraphMode(false);
              await openInActiveTab(id);
            }}
          />
        ) : workspacePath ? (
          <>
            <div className="editor-scroll">
              <div className={activeTab ? '' : 'editor-zone-hidden'}>
                <EditorNav
                  onBack={onBack}
                  onForward={onForward}
                  canGoBack={canGoBack}
                  canGoForward={canGoForward}
                />
                <EditorTitle
                  value={titleDraft}
                  onChange={setTitleDraft}
                  onCommit={onTitleCommit}
                  conflict={!!titleConflict}
                />
                {titleConflict && (
                  <ErrorMessage className="error-message-title">
                    There's already a file with the same name
                  </ErrorMessage>
                )}
              </div>
              <div className={activeTab ? '' : 'editor-zone-hidden'}>
                <Editor
                  ref={editorRef}
                  onLinkClick={fileOps.onLinkClick}
                  onChange={onEditorChange}
                  getPageIndexRef={linkIndex.pageIndexRef}
                  getVaultPathRef={workspacePathRef}
                  getActiveFilePathRef={activeFilePathRef}
                  onImageError={showError}
                  onRequestUrl={requestUrl}
                  onSendToAgent={onSendToAgent}
                  ensureActiveFilePathRef={ensureActiveFilePathRef}
                  onStats={setEditorStats}
                  dark={isDark}
                  viewMode={viewMode}
                  hideLineNumbers={hideLineNumbers}
                />
              </div>
              {activeTab ? (
                <BacklinksPanel
                  groups={activeBacklinks}
                  vaultPath={workspacePath}
                  onOpen={openInActiveTab}
                />
              ) : (
                <div className="no-tab-cta">
                  <button className="create-file-btn" onClick={onNewFile}>
                    + Create new file
                  </button>
                  <div className="no-tab-hint">or pick a file from the sidebar</div>
                </div>
              )}
            </div>
            {activeTab && (
              <EditorStatusBar
                backlinkCount={activeBacklinks.length}
                words={editorStats.words}
                chars={editorStats.chars}
                viewMode={viewMode}
                onToggleViewMode={onToggleViewMode}
                saveState={saveState}
              />
            )}
          </>
        ) : (
          <div className="empty centered">
            {bootDone ? `Welcome to ${APP_NAME}. Add a workspace from the gear icon to get started.` : ''}
          </div>
        )}
      </main>

      {chatSidebarOpen ? (
        <aside className="chat-sidebar-wrap" key={workspacePath ?? 'no-workspace'}>
          <div
            className="chat-sidebar-resize-handle"
            onMouseDown={onChatSidebarResizeStart}
          />
          <ChatSidebar ref={setChatSidebarRef} onClose={toggleChatSidebar} workspacePath={workspacePath} />
        </aside>
      ) : (
        <button
          type="button"
          className="chat-sidebar-strip"
          onClick={toggleChatSidebar}
          title="Open coding agent"
          aria-label="Open coding agent"
        >
          <svg
            className="chat-sidebar-strip-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width={16}
            height={16}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 8V4H8" />
            <rect width={16} height={12} x={4} y={8} rx={2} />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
          <span className="chat-sidebar-strip-label">Agent Chat</span>
        </button>
      )}

      {urlPromptResolve && (
        <UrlPromptModal onSubmit={handleUrlSubmit} onCancel={handleUrlCancel} />
      )}

      <Dialog
        open={!!sendToAgentPending}
        onClose={() => setSendToAgentPending(null)}
        title="Send to Agent"
        footer={
          <>
            <button className="dialog-button" onClick={() => setSendToAgentPending(null)}>
              Cancel
            </button>
            <button
              className="dialog-button"
              onClick={() => {
                const s = sendToAgentPending;
                setSendToAgentPending(null);
                if (s) applySendToAgent(s, { append: true });
              }}
            >
              Append
            </button>
            <button
              className="dialog-button dialog-button-primary"
              onClick={() => {
                const s = sendToAgentPending;
                setSendToAgentPending(null);
                if (s) applySendToAgent(s, { append: false });
              }}
            >
              Replace
            </button>
          </>
        }
      >
        The chat composer already has text. Replace it with the selection, or append to it?
      </Dialog>

      {settingsOpen && (
        <SettingsModal
          initialSection={settingsInitialSection}
          onClose={() => setSettingsOpen(false)}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onAddWorkspace={addWorkspace}
          onSwitchWorkspace={switchWorkspace}
          onRemoveWorkspace={removeWorkspace}
          themeMode={themeMode}
          onThemeModeChange={onThemeModeChange}
          hideLineNumbers={hideLineNumbers}
          onHideLineNumbersChange={onHideLineNumbersChange}
          codingAgent={codingAgentSettings}
          onCodingAgentChange={onCodingAgentChange}
          agentSecrets={agentSecrets}
          onAgentSecretsChange={onAgentSecretsChange}
        />
      )}
    </div>
  );
}

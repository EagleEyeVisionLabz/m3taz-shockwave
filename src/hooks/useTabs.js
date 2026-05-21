import { useCallback, useRef, useState } from 'react';

let nextTabId = 1;
const makeTabId = () => `t${nextTabId++}`;

/**
 * Owns: tabs, activeTabId, viewStateByPath.
 *
 * Does NOT load content into the editor — that's done by App via an effect that watches
 * activeFile and writes via the editor's imperative `setContent` API. This keeps the
 * load timing decoupled from React state-update ordering.
 *
 * Inputs:
 *   editorRef         — ref to the imperative Editor (for capturing current view state on leave)
 *   writeNow          — flushes any pending debounced save
 *   onAfterSwitch?    — optional, fires after any tab op completes (e.g., turn off graph mode)
 */
export function useTabs({ editorRef, writeNow, onAfterSwitch }) {
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const viewStateByPath = useRef(new Map());

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const activeFile = activeTab?.path ?? null;
  const activeIsDraft = !!activeTab?.isDraft;

  // Capture the editor's view state for the currently-active file BEFORE we change tabs.
  const captureCurrentViewState = useCallback(() => {
    if (!activeFile) return;
    const editor = editorRef.current;
    if (!editor) return;
    const state = editor.getViewState();
    if (state) viewStateByPath.current.set(activeFile, state);
  }, [activeFile, editorRef]);

  const renameTabsPath = useCallback((oldPath, newPath) => {
    setTabs((prev) => prev.map((t) => (t.path === oldPath ? { ...t, path: newPath, isDraft: false } : t)));
    const vs = viewStateByPath.current.get(oldPath);
    if (vs !== undefined) {
      viewStateByPath.current.set(newPath, vs);
      viewStateByPath.current.delete(oldPath);
    }
  }, []);

  const openInActiveTab = useCallback(async (filePath) => {
    await writeNow();
    captureCurrentViewState();
    setTabs((prev) => {
      if (prev.length === 0) {
        const id = makeTabId();
        setActiveTabId(id);
        return [{ id, path: filePath, isDraft: false }];
      }
      return prev.map((t) =>
        t.id === activeTabId ? { ...t, path: filePath, isDraft: false } : t,
      );
    });
    onAfterSwitch?.();
  }, [writeNow, activeTabId, captureCurrentViewState, onAfterSwitch]);

  const openInNewTab = useCallback(async (filePath) => {
    await writeNow();
    captureCurrentViewState();
    const id = makeTabId();
    setTabs((prev) => [...prev, { id, path: filePath, isDraft: false }]);
    setActiveTabId(id);
    onAfterSwitch?.();
  }, [writeNow, captureCurrentViewState, onAfterSwitch]);

  const addDraftTab = useCallback(async () => {
    await writeNow();
    captureCurrentViewState();
    const id = makeTabId();
    setTabs((prev) => [...prev, { id, path: null, isDraft: true }]);
    setActiveTabId(id);
    onAfterSwitch?.();
  }, [writeNow, captureCurrentViewState, onAfterSwitch]);

  const switchTab = useCallback(async (id) => {
    if (id === activeTabId) return;
    await writeNow();
    captureCurrentViewState();
    setActiveTabId(id);
    onAfterSwitch?.();
  }, [activeTabId, writeNow, captureCurrentViewState, onAfterSwitch]);

  const closeTab = useCallback(async (id) => {
    await writeNow();
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId) {
        if (next.length === 0) {
          setActiveTabId(null);
        } else {
          const newActive = next[Math.max(0, idx - 1)];
          setActiveTabId(newActive.id);
        }
      }
      return next;
    });
  }, [activeTabId, writeNow]);

  const closeTabsForPath = useCallback((filePath) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== filePath);
      if (next.length === prev.length) return prev;
      const activeWasClosed = prev.find((t) => t.id === activeTabId)?.path === filePath;
      if (activeWasClosed) {
        if (next.length === 0) setActiveTabId(null);
        else setActiveTabId(next[0].id);
      }
      return next;
    });
    viewStateByPath.current.delete(filePath);
  }, [activeTabId]);

  const resetTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    viewStateByPath.current.clear();
  }, []);

  /**
   * Promote a draft tab to a real file on disk. Returns the new path.
   * Concurrency-guarded so two rapid edits don't race to create two files.
   */
  const promotionInFlight = useRef(new Map());
  const promoteDraft = useCallback(async (tabId, vaultPath, { name, initialContent = '' }) => {
    if (!vaultPath) throw new Error('No active workspace');
    const existing = promotionInFlight.current.get(tabId);
    if (existing) return existing;
    const work = (async () => {
      const cleanName = (name || 'Untitled').replace(/\.md$/i, '').trim() || 'Untitled';
      const newPath = await window.api.createFile(vaultPath, `${cleanName}.md`, initialContent);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, path: newPath, isDraft: false } : t)));
      return newPath;
    })();
    promotionInFlight.current.set(tabId, work);
    try {
      return await work;
    } finally {
      promotionInFlight.current.delete(tabId);
    }
  }, []);

  return {
    tabs,
    activeTabId,
    activeTab,
    activeFile,
    activeIsDraft,
    setActiveTabId,
    setTabs,
    openInActiveTab,
    openInNewTab,
    addDraftTab,
    switchTab,
    closeTab,
    closeTabsForPath,
    renameTabsPath,
    captureCurrentViewState,
    resetTabs,
    promoteDraft,
    viewStateByPath,
  };
}

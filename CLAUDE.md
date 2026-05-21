# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — run vite + electron concurrently (vite on :5173, electron waits via `wait-on`)
- `npm run build` — vite build into `dist/`
- `npm start` — run electron against an existing build
- `npm run dist` — `vite build` then `electron-builder` (produces dmg/nsis/AppImage per `build` block in `package.json`)

No test runner, no linter configured.

## Architecture

Electron app with a Vite + React 19 renderer. The renderer is a markdown-vault editor (CodeMirror 6) with wiki-links (`[[name]]`), backlinks, tabs, drafts, multiple workspaces, and a force-graph view.

### Process boundary

- **Main** (`electron/main.js`): owns the filesystem, dialogs, context menus, settings persistence, and `nativeTheme`. All IPC handlers are registered here. Settings persist to `app.getPath('userData')/settings.json` via an atomic tmp+rename.
- **Preload** (`electron/preload.js`): exposes a single `window.api` surface. The renderer never touches Node — every fs/dialog call goes through `window.api.*`.
- **Renderer** (`src/`): React app rooted at `src/main.jsx` → `App.jsx`. Vite root is `src/` (see `vite.config.js`); build output goes to `dist/`.

### Renderer state model

`App.jsx` is the orchestrator. Three custom hooks own the heavy state:

- `useTabs` — tabs, `activeTabId`, per-path view state (cursor/scroll). Tabs may be drafts (`isDraft: true, path: null`); `promoteDraft` creates the file on disk and converts the tab. Draft promotion is guarded by an in-flight map so rapid edits don't race to create two files.
- `useLinkIndex` — wraps `createLinkIndex()` (in `src/linkIndex.js`) behind a ref + a `version` counter. The counter is `bump()`ed after every mutation so consumers can re-render. `pageIndex` (basename → path, lowercase keys) is rebuilt from the tree via `useMemo`.
- `useFileOps` — rename/duplicate/delete/link-click, and the `treeAndIndexChanged()` helper that re-reads the tree and bumps the link index after any structural change.

The **Editor** (`src/Editor.jsx`) is imperative: parent gets a ref with `setContent / getText / getViewState / clear`. `App.jsx` loads content into the editor via an effect that watches `activeFile` — this decouples load timing from React state-update ordering. The `dark` prop recreates the EditorView (theme can't be reconfigured live).

### Save lifecycle

Edits are debounced (`SAVE_DEBOUNCE_MS = 500` in `App.jsx`) via `dirtyPathRef` + `saveTimerRef`. `writeNow()` flushes immediately and is awaited before any operation that would change `activeFile` (tab switch, workspace switch, rename, delete, graph toggle, `beforeunload`). When you add a new place that changes the active file, call `writeNow()` first or you'll lose unsaved edits.

### Link index

`src/linkIndex.js` is the single source of truth for parsing `[[target|alias#heading]]` wiki-links and maintaining bidirectional indices (`outgoingByFile`, `backlinks`, `mtimes`). On workspace load, the **main** process walks the vault, pre-parses every `.md` file (`fs:readAllMarkdown` → `electron/linkParser.js`), and ships `{path, mtime, outgoingLinks}` rows to the renderer for `rebuild()`. Incremental edits/renames/deletes update the index in the renderer.

**`electron/linkParser.js` is a CommonJS mirror of the parser pieces in `src/linkIndex.js`.** If you change `LINK_RE`, `normalizeTarget`, `parseLinks`, `leadingWidth`, or `collectContext` in one, change both. The file comment calls this out.

Renames rewrite incoming `[[oldName]]` references across all files that link to the renamed page before the on-disk rename happens (`src/renameOps.js`). The regex preserves `#heading` and `|alias` suffixes.

**Terminology:** the user-facing concept is a **page** (a single `.md` document in the vault). Use "page" in UI strings, dialog text, and user-facing copy. "File" / "note" should not appear in user-visible text. Code identifiers (`useFileOps`, `FILE_ACTIONS`, `FileTree`, `writeFile`, `readFile`, etc.) keep "file" — those refer to filesystem files, which they are.

### Invariants when touching files/links

Any code that creates, modifies, renames, or deletes a `.md` file — whether through in-app actions or via the watcher path — must satisfy all of these. Skipping any one drifts the cache from disk:

1. **Link-index sync.** Create/change → `linkIndex.updateFile` or `applyParsedLinks`. Delete → `removeFile`. Rename → `renameFile`. Then `bump()` so consumers re-render.
2. **Tree refresh.** Any add/remove of a file or folder must result in `refreshTree()` (in-app: call `fileOps.treeAndIndexChanged()`; external: handled by the fs watcher).
3. **Parser parity.** `LINK_RE` / `normalizeTarget` / `parseLinks` / `leadingWidth` / `collectContext` must stay identical between `src/linkIndex.js` and `electron/linkParser.js`. The watcher in main reuses `linkParser.js`, so this constraint is now exercised on every external change.
4. **Save before mutating active file.** Per "Save lifecycle" above: `writeNow()` first, awaited.
5. **Real mtimes.** External-change handlers must use the file's `stat.mtimeMs`, not `Date.now()`. The renderer uses `Date.now()` for local in-memory updates — that's intentional, and is what makes the watcher's self-echo guard work (event mtime < stored mtime → skip).
6. **Workspace-scoped watcher.** One watcher per app. Switching or removing a workspace must `watchStop()` before doing anything else; `loadWorkspace` handles this. Don't start a watcher without stopping the previous one.
7. **Idempotent watcher handlers.** Every in-app write self-echoes ~350ms later. Handlers must be safe to re-run on the same data. The mtime guard above is the primary mechanism.
8. **Watcher does NOT touch active-file content.** External `change` events refresh tree + link index only. Re-reading editor content on disk change would clobber unsaved edits. A reload-with-prompt flow can be added later behind an mtime/dirty-state guard.

### File watcher

`chokidar` v4 in main process. One watcher per active workspace (lifecycle: started in `loadWorkspace`, stopped in `loadWorkspace`/`removeWorkspace`/`before-quit`). Events are coalesced per-path within a 150ms window; `.md` adds/changes are read + parsed in main (reusing `linkParser.js`) and shipped as `{type, path, mtime, outgoingLinks}` — the same shape `readAllMarkdown` uses on workspace load. Folder events and non-`.md` events ship `{type:'tree'}` (tree refresh only). See `electron/main.js` "workspace file watcher" section for the implementation.

### Cross-process constants to keep in sync

- `APP_NAME` lives in three places: `src/constants.js`, `electron/main.js` (`APP_NAME` const), and `package.json` (`build.productName`). Comments in each file flag this.
- `FILE_ACTIONS` is duplicated in `src/constants.js` and `electron/main.js` (used by the native context menu in `context:fileMenu`).

### Wiki-link UX inside the editor

- `src/wikiLinks.js` — CodeMirror `ViewPlugin` that replaces `[[…]]` ranges with a clickable `LinkWidget` (calls back into `onLinkClick`, which opens or creates the target via `useFileOps.onLinkClick`).
- `src/wikiCompletions.js` — autocomplete source triggered by `[[`; reads `pageIndex` and `vaultPath` through refs so completions see live data without re-creating the editor.
- `src/taskCheckboxes.js` — interactive `- [ ]` / `- [x]` rendering.

### Theme

Three modes (`light` / `dark` / `system`) stored in settings; system mode listens to `nativeTheme` updates via `theme:systemChanged`. The effective theme is set on `document.documentElement.dataset.theme` and also re-passed into the Editor (which recreates the view to swap `oneDark`).

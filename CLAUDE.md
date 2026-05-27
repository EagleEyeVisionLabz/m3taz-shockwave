# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start electron-vite (`electron-vite dev --watch --remoteDebuggingPort=9222`). Builds main + preload, serves the renderer on :5173, launches Electron, and auto-reloads on any `src/**` change. CDP for the renderer is exposed on :9222.
- `npm run build` — production build to `out/` (main, preload, renderer).
- `npm start` — `electron-vite preview` against the production build.
- `npm run dist` — build then `electron-builder` (produces dmg/nsis/AppImage per `build` block in `package.json`).
- `npm test` — run the test suite (node:test, no install needed).

No linter configured.

For day-to-day workflow (when to restart, how to read main vs renderer logs, how to attach to the renderer via CDP for headless debugging, IPC discipline), use the **electron-dev** skill at `.claude/skills/electron-dev/SKILL.md`.

## Architecture

Electron app with a Vite + React 19 renderer. The renderer is a markdown-workspace editor (CodeMirror 6) with wiki-links (`[[name]]`), backlinks, tabs, drafts, multiple workspaces, a force-graph view, a live-preview / raw view-mode toggle, an editor status bar, bookmarks, daily notes, quick search, image embeds, voice transcription, and a right-hand coding-agent chat sidebar (pi).

### Process boundary

- **Main** (`src/main/`): filesystem, dialogs, context menus, settings persistence + secret encryption, `nativeTheme`, the file watcher + rename correlator, the `app://media/...` protocol for serving workspace images, window-bounds persistence, the pi coding-agent session, skill-library management, the agent-tokens pi extension, the AssemblyAI voice-token mint. All IPC handlers are registered here. Entry: `src/main/main.js`. **Deep doc: `src/main/CLAUDE.md`.**
- **Preload** (`src/preload/preload.cjs`): exposes a single `window.api` surface. The renderer never touches Node — every fs/dialog/agent call goes through `window.api.*`. Also exposes `webUtils.getPathForFile` so the renderer can resolve drag-dropped folder paths (skill import).
- **Renderer** (`src/renderer/`): React app rooted at `main.jsx` → `App.jsx`. Vite root is `src/renderer/` (configured in `electron.vite.config.js`); build output goes to `out/renderer/`. Built main/preload land at `out/main/index.js` and `out/preload/index.cjs`. **Deep doc: `src/renderer/CLAUDE.md`.**

### Where things live

| Area | File(s) | Deep doc |
|---|---|---|
| Main-process internals (watcher, IPC, settings, app://, coding agent, voice token) | `src/main/*.js` | `src/main/CLAUDE.md` |
| Renderer internals (hooks, editor decorations, chat sidebar, voice, bookmarks, daily notes, quick search) | `src/renderer/**` | `src/renderer/CLAUDE.md` |
| Cross-process constants | `src/shared/constants.js` | this file, below |
| Tests | `tests/*.test.js` | `tests/CLAUDE.md` |

## Terminology

The canonical names. Use these in UI strings, comments, docs, agent prompts — anywhere a human (user or contributor) might read them.

- **File** — a `.md` document in the workspace. The user-facing noun for the thing you create / open / edit / delete. **Never use "page" or "note"** — both were earlier conventions that have been retired.
- **Basename** — a file's name with no folder path and no `.md` extension. For `notes/projects/Foo.md`, the basename is `Foo`. This is what wiki-links use, and what the link index is keyed by.
- **Workspace** — the folder on disk the user has opened. Everything inside it (files, images, other assets) is part of the workspace. Code sometimes still says "vault" (Obsidian-inherited); new code uses "workspace".
- **Wiki-link** — the `[[Some File]]` syntax linking one file to another by basename. The term comes from MediaWiki/Obsidian/etc. Variants: `[[File#Heading]]`, `[[File|Display]]`. Resolution is workspace-wide, case-insensitive, basename-only — never include a folder path. The parser + index live in `src/renderer/linkIndex.js`.
- **External link** — the `[label](https://…)` markdown form. Always means an off-workspace URL. Opens in the system browser. Not to be confused with wiki-links.
- **Backlink** — a wiki-link that points *at* a given file from elsewhere. The link index maintains backlinks per file; the backlinks panel under the editor reads from that.

Avoid: "page", "note", "document" (for `.md` files), "vault" (in new code/copy), "internal link" (call it a wiki-link).

## Invariants when touching files/links

Any code that creates, modifies, renames, or deletes a `.md` file — whether through in-app actions or via the watcher path — must satisfy all of these. Skipping any one drifts the cache from disk:

1. **Link-index sync.** Create/change → `linkIndex.updateFile` or `applyParsedLinks`. Delete → `removeFile`. Rename → `renameFile`. Then `bump()` so consumers re-render.
2. **Tree refresh.** Any add/remove of a file or folder must result in `refreshTree()` (in-app: call `fileOps.treeAndIndexChanged()`; external: handled by the fs watcher).
3. **Folder rename re-keys nested files.** Renaming a folder changes every nested file's path. The handler (`onTreeRename` in `App.jsx`) walks `getOutgoingMap()` for paths under the old folder, calls `linkIndex.renameFile(oldP, newP)` and `renameTabsPath(oldP, newP)` for each, and shifts `selectedFolderPath` if it pointed inside. `onMoveItems` does the same for drag-and-drop moves. Without this, the index carries stale path keys until the watcher echoes per-file events, and open tabs inside the renamed folder break.
4. **Parser parity.** `LINK_RE` / `normalizeTarget` / `parseLinks` / `leadingWidth` / `collectContext` must stay identical between `src/renderer/linkIndex.js` and `src/main/linkParser.js`. The watcher in main reuses `linkParser.js`, so this constraint is exercised on every external change. `tests/parserParity.test.js` enforces this.
5. **Save before mutating active file.** `writeNow()` first, awaited. See "Save lifecycle" in `src/renderer/CLAUDE.md`.
6. **Real mtimes.** External-change handlers must use the file's `stat.mtimeMs`, not `Date.now()`. The renderer uses `Date.now()` for local in-memory updates — that's intentional, and is what makes the watcher's self-echo guard work (event mtime < stored mtime → skip).
7. **Workspace-scoped watcher.** One watcher per app. Switching or removing a workspace must `watchStop()` before doing anything else; `loadWorkspace` handles this. Don't start a watcher without stopping the previous one. Starting also seeds the rename correlator (stat + hash every `.md` under the root) so unlinks fired immediately after `watchStart` can still be correlated.
8. **Idempotent watcher handlers.** Every in-app write self-echoes ~350ms later. Handlers must be safe to re-run on the same data. The mtime guard is the primary mechanism. For `rename` events, the renderer's handler is also idempotent (`linkIndex.renameFile` of an already-renamed path is a no-op; the regex rewrite matches nothing because refs are already rewritten).
9. **Watcher reloads the active file on external change.** When `evt.path === activeFile` and the event is fresh (`evt.mtime > stored mtime`), the renderer reads the new content, calls `editor.setContent(text, viewState)` to preserve cursor/scroll, then flashes the added text green via `editor.flashRanges(ranges)`. The diff is word-level (`diff` npm, `diffWordsWithSpace`). Reload runs unconditionally — if a keystroke lands in the same instant the agent (or any external writer) modifies the file, the keystroke loses. The save-debounce window is 500ms so this is rare. The renderer's own writes don't trigger this path because the self-echo's mtime is ≤ the stored mtime (see invariant #6). See `src/renderer/diffFlash.js` for the flash extension.
10. **Self-references are rewritten on rename.** `renameOps.js` does NOT skip `src === oldPath`. If `Foo.md` contains `[[Foo]]` and is renamed to `Bar.md`, the on-disk file ends up containing `[[Bar]]`. Don't reintroduce the skip.

## Cross-process constants

- `APP_NAME` lives in **two** places: `src/shared/constants.js` (single source of truth, imported by both processes) and `package.json` (`build.productName` — electron-builder uses it for `.app`/`.dmg` names at build time). Comments in each file flag this.
- `FILE_ACTIONS`, `FOLDER_ACTIONS`, `EDITOR_ACTIONS`, `SUPPORTED_PROVIDER_SLUGS`, `DEFAULT_PROVIDER_SLUG` — all in `src/shared/constants.js`. Both `src/main/main.js` (native context menus, provider filter) and `src/renderer/constants.js` (re-export + renderer-only additions) import from there. `EDITOR_ACTIONS.SEND_TO_AGENT` is enabled only when the active file has a path on disk (drafts opt out).
- Renderer-only constants (`SETTINGS_SECTIONS`, `THEME_MODES`, `VIEW_MODES`, `SAVE_STATES`, `TREE_SORT_ORDERS`, `TREE_SORT_LABELS`) live in `src/renderer/constants.js`.
- `DEFAULT_SETTINGS` in `src/main/main.js` is the schema for `settings.json`. Top-level keys: `workspaces`, `activeWorkspaceId`, `appearance`, `dailyNote`, `codingAgent`, `agentSecrets[]`, `transcription`, `chatSidebarOpen`, `chatSidebarWidth`, `treeSortOrder`, `windowBounds`. Adding a persisted field means updating `DEFAULT_SETTINGS`, the `readSettings` deep merge, and every `persistSettings()` call site in `App.jsx` (which passes the whole object on each write).

## Workspace-wide name uniqueness

The link index is keyed by basename, so two files sharing a name break it. IPC handlers `fs:renameFile`, `fs:moveItem`, `fs:createFile` call `uniqueInWorkspace` (in `src/main/pathResolver.js`) to auto-disambiguate workspace-wide: if a target basename already exists anywhere, the operation succeeds with `" 1"`, `" 2"`, … appended. The renderer-side `findNameConflict` (in `App.jsx`) does the matching live-warning check while the user types in the title input (workspace-wide, case-insensitive). Folder renames stay same-folder-unique because folders aren't part of the link index.

This is a deliberate simplification — Obsidian allows duplicate basenames and uses path-prefixed links (`[[folder/Foo]]`) to disambiguate. See `docs/path-prefixed-links.md` for the design of that future direction.

## Tests

`npm test` runs everything via `node:test` (no install). See **`tests/CLAUDE.md`** for the per-file coverage table and what's not covered by automated tests.

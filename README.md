# Shockwave

A local, file-based markdown vault editor for macOS / Windows / Linux. Built with Electron + Vite + React + CodeMirror 6.

Your notes are plain `.md` files in a folder you choose. No database, no cloud, no proprietary format.

---

## Quick start

```bash
npm install
npm run dev        # dev (vite + electron, HMR)
npm run build      # production renderer bundle
npm start          # run electron against an existing build
npm run dist       # build + package (.dmg / .nsis / .AppImage)
npm test           # run unit + integration tests
```

---

## Workspaces

A "workspace" is just a folder on disk that contains your `.md` files (and any other files you want — images, PDFs, etc).

- Open one from **Settings → Workspaces → Add workspace**
- Switch between workspaces with the workspace picker at the bottom of the sidebar
- Multiple workspaces can be registered; only one is active at a time
- The last active workspace re-opens on launch

Workspace list, active workspace, theme, AI settings, and sidebar width are persisted to `app.getPath('userData')/settings.json` (atomic tmp+rename writes).

---

## Editor

CodeMirror 6 with markdown highlighting plus a few in-place renderers so the source stays editable but reads cleanly:

- `# Heading` — sized + bold; the `#` markers are hidden when the cursor isn't on the line
- `- item` / `* item` / `+ item` — the marker renders as `•`
- `- [ ]` / `- [x]` — interactive checkboxes (click to toggle)
- `[text](https://…)` — auto-detected URLs render as clickable links
- `![](image.png)` — images render inline (right-click → "Open original" available)
- `[[Wiki link]]` — see below

Other editor behavior:

- Auto-save: edits flush to disk 500ms after you stop typing (or immediately on tab switch, workspace switch, rename, app quit)
- Line wrapping is on
- Setext headings (`text\n===` / `text\n---`) are disabled — only ATX (`# / ##`) headers are recognized, so typing `-` on a new line doesn't briefly turn the line above into a heading
- One Dark theme in dark mode, default highlight style in light mode
- Light / dark / system theme (Settings → Appearance); "system" follows your OS

---

## Wiki-links

The core linking primitive. Inside any `.md` file:

| Syntax | Goes to | Displays |
|---|---|---|
| `[[Note]]` | `Note.md` | `Note` |
| `[[Note#Section]]` | `Note.md`, scrolled to the `Section` heading | `Note > Section` |
| `[[Note\|My label]]` | `Note.md` | `My label` |
| `[[Note#Section\|My label]]` | `Note.md` at `Section` | `My label` |

Notes:

- Names are matched case-insensitively across the whole workspace
- Clicking a link to a non-existent note **creates it** in the current folder
- Autocomplete triggers when you type `[[` — start typing the note name to filter
- Right-click in the editor → "Add link" wraps selection in `[[…]]` or opens a quick picker
- The link index is built once on workspace load (main process walks the vault and parses every `.md`) and maintained incrementally on edits/renames/deletes/external changes

---

## Rename behavior

Rename a note via:

- Double-click in the tree
- Right-click → Rename
- Edit the title input at the top of the editor

What happens on rename:

- **`[[old]]` references across all files are rewritten to `[[new]]`** before the on-disk rename
- `#heading` and `|alias` suffixes are preserved: `[[old#Topic|Label]]` → `[[new#Topic|Label]]`
- The file is moved on disk to the new name
- Open tabs for the old path are updated to point at the new path
- The tree and link index refresh

Plain markdown links (`[label](old.md)`) and bare text mentions are **not** rewritten — only `[[wiki]]` references.

If the new name would collide with an existing file in the same folder, the title input shows a conflict warning and the rename is blocked until you change it.

---

## Tabs and navigation

- Click `+` on the tab strip to open a new draft tab (no file on disk until you type a title)
- Drafts get promoted to real files when you set a title — the file lands in the currently-selected folder (or the workspace root)
- Per-tab back/forward navigation history (arrows at top-left of the editor) — every navigation within a tab is tracked
- Each tab remembers its cursor position and scroll offset

---

## File tree

- Right-click any file: **Open in new tab** (md only), **Duplicate**, **Reveal in Finder/Explorer**, **Rename**, **Delete** (moves to OS trash)
- Right-click any folder: **New file**, **New folder**, **Reveal**, **Rename**, **Delete**
- Drag-drop within the tree to move files between folders
- **Drag an image from the tree into the editor** — inserts `![](relative/path.png)` at the cursor
- The sidebar is resizable — drag the right edge; the width is persisted

---

## Backlinks

A backlinks panel under the editor shows every other file that links to the current one, with the surrounding line of context. Click an entry to jump there.

The link index maintains backlinks bidirectionally in memory; the panel is computed live from it.

---

## Graph view

Toggle the graph icon in the thin left sidebar to switch the editor for a force-directed graph of all notes and their links. Click a node to open the note.

---

## Images and other files

- **Paste an image** from the clipboard into the editor — it's saved next to the current `.md` and inserted as `![](filename)`
- **Drop OS files** onto the editor — same as paste for images
- **Drag from the in-app file tree** — inserts a relative-path markdown image link without copying the file
- Non-image files can live in the workspace; they show in the tree but aren't indexed for links

Image filenames use the source name if there is one (sans extension), or `Pasted image YYYY-MM-DD HH-MM-SS` for clipboard pastes. Collisions get ` 1`, ` 2`, … appended.

---

## AI / Inline coding agent

Optional. Configure in **Settings → AI**:

- Provider: **Anthropic** or **OpenAI**
- Model (free-text — must match a model ID the provider accepts)
- API key (stored locally in `settings.json`)
- "Include document context by default" toggle

Once configured, in the editor:

- Right-click → **Inline AI** (with or without a selection)
- With a selection → **Rewrite** the selection given an instruction
- Without a selection → **Insert** generated text at the cursor

Responses stream into the document as they arrive. Saves are debounced normally during the stream; tab/workspace switch cancels in-flight streams.

---

## File watcher

`chokidar` watches the active workspace for external changes (a sync client, a CLI edit, `git pull`, etc).

- External `.md` adds / changes / deletes / renames refresh the tree and link index
- Renames are detected by inode + content-hash correlation (`electron/renameCorrelator.js`) so a paired unlink+add becomes a true rename event, preserving outgoing-link identity
- The watcher does **not** reload the active file's editor contents on external change (would clobber unsaved edits)
- Every in-app write self-echoes via the watcher ~350ms later; an mtime guard makes those echoes idempotent

---

## Settings

Persisted to `app.getPath('userData')/settings.json`:

- `workspaces[]`, `activeWorkspaceId`
- `appearance.themeMode` — `light` / `dark` / `system`
- `ai` — provider, model, apiKey, includeContextByDefault
- `sidebarWidth` — pixels (drag the divider to set)

---

## Architecture (short version)

- **Main process** (`electron/main.js`) — filesystem, dialogs, native context menus, the file watcher, settings persistence, theme
- **Preload** (`electron/preload.cjs`) — exposes a single `window.api` surface to the renderer; the renderer never touches Node directly
- **Renderer** (`src/`) — React 19 + CodeMirror 6; `App.jsx` orchestrates state via three hooks (`useTabs`, `useLinkIndex`, `useFileOps`)
- **Link parser** is duplicated in `src/linkIndex.js` (renderer) and `electron/linkParser.js` (main, used by the watcher). The two are kept in lockstep; `tests/parserParity.test.js` enforces it

See `CLAUDE.md` for the full architectural notes.

---

## Tests

```bash
npm test
```

Covers the link index, parser parity, rename ops, the rename correlator (unit + integration), and the end-to-end linking system.

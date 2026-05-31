# Plain-text editor — design & research (paused, not built)

Status as of 2026-05-31: **researched + design agreed, NOT built.** Paused to test GitHub sync first. This doc is the full context to resume cold.

## Goal

Non-`.md` text files (`.txt`, `.json`, code, etc.) currently open in the **markdown** editor — so markdown formatting renders and, worse, the markdown keymap fires (e.g. Enter auto-continues a `- ` list, inserting stray characters into the file). We want non-`.md` text files to open as **true plain text: zero markdown behavior, by construction.**

(Images/video already render in `MediaView` — see `src/renderer/MediaView.tsx`. Plain text is the third case.)

## Decision: a separate component, NOT gate-and-suppress

The clean pattern is the one already in the codebase: **MediaView.** An image doesn't open the markdown editor with image-stuff suppressed — App renders a *different component*. Plain text does the same.

**Rejected approach (gate-and-suppress):** keep one editor, conditionally turn off markdown pieces. Rejected because it leaks — you'd have to hunt down and suppress every markdown surface, and miss some:
- the editor right-click menu still offers "Add wiki-link" `[[…]]` / "Add external link" `[text](url)`
- the title bar renames via the `.md`-forcing path → editing a `.txt` title turns it into `.md`
- the Live/Raw toggle (no preview to toggle)
- `[[` autocomplete, image-paste (`![](…)`)
- the markdown keymap (stray `-`/list continuation) — the original complaint

"Clean as fuck = nothing markdown is ever mounted for a plain file," so: separate component.

## Design

New `PlainTextEditor` — a CodeMirror instance built with **only base text extensions**. App branches, exactly like the existing media branch:
- image/video → `MediaView`
- text, not `.md` → `PlainTextEditor`
- else → markdown `Editor`

All three editors expose the **same imperative ref contract** (`getText`/`setContent`/`getViewState`/`clear`/`flashRanges`/`setReadOnly`/`focus`/`undo`/`redo`), so App's save/load/dirty machinery (`writeNow`, the content-load effect, `onChange`) talks to whichever is mounted — unchanged.

### Carries over (generic, keep in plain editor)
undo/redo (`history` + keybindings), word/char count (`onStats`), **save** (same `writeNow` → `getText()` → write file), **sync** (file-based: saving writes to disk, git picks it up), line numbers, active-line highlight, line wrapping, cursor/scroll restore on tab-switch, dark theme, the "hide line numbers" appearance setting, the green-flash on external change (`diffFlash`), and the **Message Agent** right-click action.

### Drops (markdown-only, never mounted)
markdown language + syntax styling, live-preview decorations, list/task/outdent keymaps, wiki-links, `[[` autocomplete, image embeds, image-paste, the title bar, Live/Raw toggle, backlinks, and the Add-link/external-link context-menu actions.

### `plainText` computation (App)
```
plainText = !!activeFile && !activeIsDraft && !mediaKind(activeFile) && !/\.md$/i.test(activeFile)
```
(drafts are always new `.md` notes; media goes to MediaView.)

### No live reconfigure / no hacks
The markdown editor already **rebuilds on `dark`** (`Editor.tsx` ~line 421, deps `[dark]`; theme can't reconfigure live so it rebuilds). The plain editor is a separate component built once with base-only extensions — there's nothing to toggle. Stray list-continuation is **impossible by construction** (the keymap isn't loaded).

## Open architecture question (undecided — pick on resume)

Should the two editors share a base, or be independent?

- **Recommended: lightweight shared base** — extract `baseEditorExtensions(...)` factory + the shared imperative-ref builder + the Message-Agent context-menu helper into a small module. `Editor` = base + markdown layer; `PlainTextEditor` = base only.
  - Win: no duplication → no drift (the "fix one, forget the other" bug class).
  - Cost: refactor the *existing, working* markdown `Editor` to pull the base out — low but nonzero regression risk (mitigate with gates + manual check).
- **Alternative: duplicate the base** into the new file — fast, zero risk to the working editor, but two ~100-line copies that will drift.

## Files to touch (when building)
- `src/renderer/PlainTextEditor.tsx` — new (base-only CM + shared ref API).
- (optional) `src/renderer/editorBase.ts` — shared base factory + ref-API builder + message-agent helper, if we go shared-base.
- `src/renderer/App.tsx` — compute `plainText`; render branch (media / plain / markdown); **don't render the title bar or Live/Raw toggle for plain**; thread `plainText` into the content-load effect tracking.
- `src/main/main.ts` — editor context menu: for plain files, offer only **Message Agent** (drop Add-link / external-link).

## Verification notes
- No runtime pre-test needed for "no markdown behavior": an extension that isn't loaded can't fire — guaranteed by construction.
- Gates: typecheck / lint / build / `npm test` (77). Markdown editor must still behave identically (manual check) — that's the only regression surface if we share a base.
- UI itself isn't headlessly testable (react-arborist doesn't remount under CDP-driven reloads); the user tests in the real window.

## Related
- `src/renderer/MediaView.tsx` — the pattern to mirror.
- `src/renderer/Editor.tsx` — the markdown editor; `~line 421` is the dark-rebuild pattern.
- Memory: `sync-conflict-resolution-plan.md` lists this as a deferred item.

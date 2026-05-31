// Image paste & drop for the markdown editor.
//
// Catches image files pasted or dropped into the editor, saves them next to
// the active .md (via window.api.writeImage), and inserts a markdown image
// reference `![](filename)` at the cursor. Multiple images are concatenated.
//
// Drafts: when the active tab has no file on disk yet, we call
// `flushDraftToDisk` which forces the pending save (creating the file via the
// normal save path). Once that returns, the .md exists and we can write the
// image next to it.
//
// Filename strategy:
//   - Pasted screenshots arrive with no name → use timestamp ("Pasted image …").
//   - Dropped files arrive with a real name → use that, sans extension.
//   The main-process handler runs the chosen base through uniquePath() so
//   collisions get " 1", " 2", … appended automatically.

import { EditorView, ViewPlugin } from '@codemirror/view';
import { dirOf } from './pathUtils';

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
};

function extFor(file) {
  return MIME_TO_EXT[file.type] ?? null;
}

function basenameNoExt(name) {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// Markdown URL encoding. CommonMark rejects literal whitespace in `(url)`
// form, and parens break the closing `)`. encodeURI() handles every kind
// of whitespace (regular space, NBSP, tabs) plus other URL-invalid chars
// while preserving slashes, alphanumerics, dots, and dashes for readability.
function encodeMarkdownUrl(name) {
  return encodeURI(name).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

async function handleImageFiles(view, files, { getActiveFilePath, flushDraftToDisk, onError }) {
  let activePath = getActiveFilePath?.();
  if (!activePath && flushDraftToDisk) {
    try {
      activePath = await flushDraftToDisk();
    } catch (err: any) {
      onError?.(err?.message ?? String(err));
      return;
    }
  }
  if (!activePath) {
    onError?.('Save this file before adding images.');
    return;
  }
  const targetDir = dirOf(activePath);
  if (!targetDir) {
    onError?.('Cannot determine folder for image.');
    return;
  }

  const insertions: string[] = [];
  for (const file of files) {
    const ext = extFor(file);
    if (!ext) continue;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const baseName = file.name ? basenameNoExt(file.name) : '';
      const savedAbsPath = await window.api.writeImage(targetDir, bytes, ext, baseName);
      const filename = savedAbsPath.slice(savedAbsPath.lastIndexOf('/') + 1);
      insertions.push(`![](${encodeMarkdownUrl(filename)})`);
    } catch (err: any) {
      onError?.(err?.message ?? String(err));
    }
  }
  if (insertions.length === 0) return;

  const insert = insertions.join('\n');
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  });
}

function pickImageFiles(fileList) {
  if (!fileList || fileList.length === 0) return [];
  return [...fileList].filter((f) => extFor(f));
}

// HTML5 drag-drop quirk: `drop` only fires if `dragover` has called
// preventDefault — otherwise the browser handles the drop itself (which,
// in Electron, means navigating away to the file). We claim the event
// whenever Files are being dragged so the drop reaches our handler.
function isFileDrag(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  // DOMStringList in some browsers, plain Array in others — both support contains/includes via [...].
  return [...types].includes('Files');
}

// Custom dataTransfer MIME for sidebar→editor (and →chat) image drags. The tree
// row sets the workspace-absolute path under this type on dragstart; the editor
// drop reads it back. react-arborist's react-dnd backend is scoped to the tree
// element (Tree's `dndRootElement`), so it no longer hijacks drags that land
// outside the tree — the editor receives the native drop cleanly.
export const SIDEBAR_IMAGE_MIME = 'application/x-shockwave-image-path';
function isSidebarImageDrag(e) {
  const types = e.dataTransfer?.types;
  return !!types && [...types].includes(SIDEBAR_IMAGE_MIME);
}

// Posix relative path from `fromDir` to absolute `toPath`. Both inputs are
// posix-style (forward slashes). Used only for in-app sidebar→editor drops.
function posixRelative(fromDir, toPath) {
  const fromParts = fromDir.split('/').filter(Boolean);
  const toParts = toPath.split('/').filter(Boolean);
  let i = 0;
  while (i < fromParts.length && i < toParts.length - 1 && fromParts[i] === toParts[i]) i++;
  const up = fromParts.slice(i).map(() => '..');
  const down = toParts.slice(i);
  return [...up, ...down].join('/');
}

async function insertSidebarImage(view, srcAbsPath, { getActiveFilePath, flushDraftToDisk, onError }) {
  let activePath = getActiveFilePath?.();
  if (!activePath && flushDraftToDisk) {
    try {
      activePath = await flushDraftToDisk();
    } catch (err: any) {
      onError?.(err?.message ?? String(err));
      return;
    }
  }
  if (!activePath) {
    onError?.('Open a file before adding images.');
    return;
  }
  const targetDir = dirOf(activePath);
  const rel = targetDir && srcAbsPath.startsWith(targetDir + '/')
    ? srcAbsPath.slice(targetDir.length + 1)
    : posixRelative(targetDir, srcAbsPath);
  const insert = `![](${encodeMarkdownUrl(rel)})`;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  });
}

// Paste is handled via CM6's domEventHandlers (no precedence issue —
// nothing else preventDefaults the clipboard paste in capture phase).
//
// Drop is attached directly to view.contentDOM via a ViewPlugin so it can
// `stopImmediatePropagation` before CM6's own built-in drop handler runs —
// CM6 would otherwise readAsText the dropped image bytes and insert garbage.
// (react-dnd no longer factors in here: it's scoped to the tree element, so it
// doesn't touch drops that land in the editor.)
const pasteHandler = ({ getActiveFilePath, flushDraftToDisk, onError }) =>
  EditorView.domEventHandlers({
    paste(e, view) {
      const images = pickImageFiles(e.clipboardData?.files);
      if (images.length === 0) return false;
      e.preventDefault();
      handleImageFiles(view, images, { getActiveFilePath, flushDraftToDisk, onError });
      return true;
    },
  });

const dropPlugin = ({ getActiveFilePath, flushDraftToDisk, onError }) =>
  ViewPlugin.define((view) => {
    const onDragOver = (e) => {
      if (!isFileDrag(e) && !isSidebarImageDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e) => {
      if (isSidebarImageDrag(e)) {
        const srcPath = e.dataTransfer.getData(SIDEBAR_IMAGE_MIME);
        e.preventDefault();
        e.stopImmediatePropagation();
        if (srcPath) insertSidebarImage(view, srcPath, { getActiveFilePath, flushDraftToDisk, onError });
        return;
      }
      const images = pickImageFiles(e.dataTransfer?.files);
      if (images.length === 0) return;
      // stopImmediatePropagation so CM6's internal drop handler (which would
      // try to readAsText on image bytes and insert garbage) doesn't run.
      e.preventDefault();
      e.stopImmediatePropagation();
      handleImageFiles(view, images, { getActiveFilePath, flushDraftToDisk, onError });
    };
    view.contentDOM.addEventListener('dragover', onDragOver);
    view.contentDOM.addEventListener('drop', onDrop);
    return {
      destroy() {
        view.contentDOM.removeEventListener('dragover', onDragOver);
        view.contentDOM.removeEventListener('drop', onDrop);
      },
    };
  });

export function imagePaste(opts) {
  return [pasteHandler(opts), dropPlugin(opts)];
}

// Inline image rendering for the markdown editor.
//
// Walks the syntax tree (same pattern as `markdownLinks.js`) and emits a
// `Decoration.replace` widget for each `![alt](url)` whose range does NOT
// overlap the current selection. When the cursor enters the image's range,
// the decoration is skipped on the next rebuild and the raw markdown reveals
// so the user can edit it — same convention as the other live-preview
// decorations in this codebase.
//
// Why not `MatchDecorator` anymore: that helper only rebuilds on docChanged /
// viewportChanged. Cursor-aware reveal needs `selectionSet` too. The earlier
// version warned about "cursor jitter" from selection-driven rebuilds, but
// `markdownLinks.js` does exactly this without trouble, so the warning was
// stale.

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { dirOf } from './pathUtils.js';

const IMAGE_RE = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;

class ImageWidget extends WidgetType {
  constructor(url, alt, linkUrl) {
    super();
    this.url = url;
    this.alt = alt;
    this.linkUrl = linkUrl || null;
  }
  eq(other) {
    return other.url === this.url && other.alt === this.alt && other.linkUrl === this.linkUrl;
  }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = this.linkUrl ? 'cm-image-embed cm-image-embed-linked' : 'cm-image-embed';
    const img = document.createElement('img');
    img.src = this.url;
    img.alt = this.alt || '';
    img.loading = 'lazy';
    if (this.linkUrl) {
      img.title = this.linkUrl;
      // Swallow mousedown so CM doesn't place the cursor in the link range,
      // which would trigger markdownLinks' cursor-aware reveal.
      wrap.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      wrap.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.api.openExternal(this.linkUrl);
      });
    }
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent(event) {
    // Linked images need the widget to receive mousedown/click so its handler
    // can open the URL. Plain images have no widget-side handler, so let CM
    // treat the event as if the widget weren't there — that places the cursor
    // adjacent to the widget on a single click (otherwise the user has to
    // double-click to get a cursor there).
    if (!this.linkUrl) return true;
    return event.type !== 'mousedown' && event.type !== 'click';
  }
}

// Walk up from a position to find a wrapping Link node, and extract its URL.
function findWrappingLinkUrl(state, pos) {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos, 1);
  while (node) {
    if (node.name === 'Link') {
      let c = node.firstChild;
      while (c) {
        if (c.name === 'URL') return state.doc.sliceString(c.from, c.to);
        c = c.nextSibling;
      }
      return null;
    }
    node = node.parent;
  }
  return null;
}

// Resolve a markdown image URL to a loadable src. Returns null when the path
// resolves outside the workspace — those stay as plain text rather than
// render something the protocol handler will 403 anyway.
function resolveImageUrl(raw, activeDir, vault) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^(https?:|data:|app:|file:)/i.test(trimmed)) return trimmed;
  let decoded;
  try { decoded = decodeURI(trimmed); } catch { decoded = trimmed; }
  let abs;
  if (decoded.startsWith('/')) abs = decoded;
  else abs = (activeDir ? activeDir + '/' : '') + decoded;
  const parts = abs.split('/');
  const norm = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') norm.pop();
    else norm.push(seg);
  }
  abs = '/' + norm.join('/');
  if (!vault) return null;
  if (abs !== vault && !abs.startsWith(vault + '/')) return null;
  const rel = abs === vault ? '' : abs.slice(vault.length + 1);
  return 'app://media/' + rel.split('/').map(encodeURIComponent).join('/');
}

function buildDecorations(view, getActiveFilePath, getVaultPath) {
  const builder = new RangeSetBuilder();
  const state = view.state;
  const ranges = state.selection.ranges;
  const touchesSelection = (from, to) => {
    for (const r of ranges) {
      if (r.from <= to && r.to >= from) return true;
    }
    return false;
  };
  const activePath = getActiveFilePath();
  const vault = getVaultPath();
  const activeDir = dirOf(activePath || '');

  // Scan the visible ranges with a regex (cheap; same shape as before via
  // MatchDecorator). Emit replace decorations for matches that don't overlap
  // the selection.
  const decos = [];
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    IMAGE_RE.lastIndex = 0;
    let m;
    while ((m = IMAGE_RE.exec(text)) !== null) {
      const matchFrom = from + m.index;
      const matchTo = matchFrom + m[0].length;
      if (touchesSelection(matchFrom, matchTo)) continue;
      const alt = m[1];
      const rawUrl = m[2];
      const src = resolveImageUrl(rawUrl, activeDir, vault);
      if (!src) continue;
      const linkUrl = findWrappingLinkUrl(state, matchFrom);
      decos.push({
        from: matchFrom,
        to: matchTo,
        deco: Decoration.replace({ widget: new ImageWidget(src, alt, linkUrl) }),
      });
    }
  }
  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const d of decos) builder.add(d.from, d.to, d.deco);
  return builder.finish();
}

export function imageWidgets(getActiveFilePath, getVaultPath) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view, getActiveFilePath, getVaultPath);
      }
      update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view, getActiveFilePath, getVaultPath);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.decorations || Decoration.none,
        ),
    },
  );
}

import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const TASK_RE = /^(\s*[-*+]\s+)\[([ xX])\]/;

class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }

  eq(other) {
    return this.checked === other.checked;
  }

  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task-checkbox';

    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    box.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      const snippet = view.state.doc.sliceString(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(snippet)) return;
      const newChar = this.checked ? ' ' : 'x';
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: newChar },
      });
    });

    return box;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown' && event.type !== 'click';
  }
}

function buildDecorations(view) {
  const builder = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const match = line.text.match(TASK_RE);
      if (match) {
        const bracketStart = line.from + match[1].length;
        const bracketEnd = bracketStart + 3;
        const checked = match[2] === 'x' || match[2] === 'X';
        builder.add(
          bracketStart,
          bracketEnd,
          Decoration.replace({ widget: new CheckboxWidget(checked) })
        );
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const taskCheckboxes = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

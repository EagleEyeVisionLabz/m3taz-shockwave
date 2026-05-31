import { KeyBinding } from '@codemirror/view';
import { getIndentUnit } from '@codemirror/language';

// Enter on a whitespace-only indented line drops one indent level instead of
// copying the indent forward. Markdown's language provides no indent service, so
// the default insertNewlineAndIndent deletes the blank line's indent and then
// re-adds the identical amount — a no-op the user sees as "the tab stuck".
//
// Mirrors how lists/tasks already outdent on Enter (insertNewlineContinueMarkup,
// taskEnterKeymap), but for plain prose. Bound AFTER markdownKeymap and BEFORE
// defaultKeymap: lists/quotes/tasks consume Enter first; non-blank lines return
// false here and fall through to the default (keeping their indent).
//
//   blank indented line + Enter  →  outdent one level in place (no new line)
//   anything else                →  false (default behavior)
export const blankLineOutdentKeymap: KeyBinding[] = [{
  key: 'Enter',
  run: (view) => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty) return false;
    const line = state.doc.lineAt(sel.head);
    // Only act on a whitespace-only line with the cursor at its end.
    if (line.text.trim() !== '' || line.text === '' || sel.head !== line.to) return false;

    const indent = line.text;
    const unit = getIndentUnit(state);
    // Drop one tab, or one indent-unit's worth of spaces.
    const reduced = indent.endsWith('\t')
      ? indent.slice(0, -1)
      : indent.slice(0, Math.max(0, indent.length - unit));

    // Outdent in place — no new line. The cursor stays on this line, one level back.
    view.dispatch(state.update({
      changes: { from: line.from, to: line.to, insert: reduced },
      selection: { anchor: line.from + reduced.length },
      scrollIntoView: true,
      userEvent: 'input',
    }));
    return true;
  },
}];

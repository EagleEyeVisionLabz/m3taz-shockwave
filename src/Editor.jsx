import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput } from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { oneDark } from '@codemirror/theme-one-dark';
import { taskCheckboxes } from './taskCheckboxes.js';
import { bulletPoints } from './bulletPoints.js';
import { wikiLinks } from './wikiLinks.js';
import { wikiLinkCompletions } from './wikiCompletions.js';
import { EDITOR_ACTIONS } from './constants.js';

/**
 * Imperative editor wrapper.
 *
 * Props:
 *   onLinkClick(name)              — wiki-link clicks
 *   onChange()                     — fired when the user changes the doc (not for programmatic load)
 *   getPageIndexRef                — ref whose .current is the latest pageIndex Map (autocomplete reads it live)
 *   getVaultPathRef                — ref whose .current is the active workspace path
 *   dark                           — boolean; when changed, the editor is recreated with/without oneDark
 *
 * Ref API (parent uses it to load content + read state):
 *   setContent(text, viewState?)   — replaces doc; restores cursor/scroll if viewState provided, else resets to top
 *   getText()                      — current doc text
 *   getViewState()                 — { cursor, scrollTop } snapshot
 *   clear()                        — empties the doc, resets cursor
 */
const Editor = forwardRef(function Editor(
  { onLinkClick, onChange, getPageIndexRef, getVaultPathRef, onRequestUrl, dark },
  ref,
) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const linkClickRef = useRef(onLinkClick);
  const changeRef = useRef(onChange);
  const requestUrlRef = useRef(onRequestUrl);
  const isProgrammaticRef = useRef(false);

  useEffect(() => { linkClickRef.current = onLinkClick; }, [onLinkClick]);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => { requestUrlRef.current = onRequestUrl; }, [onRequestUrl]);

  const handleContextMenu = async (e) => {
    e.preventDefault();
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const hasSelection = from !== to;
    const action = await window.api.showEditorContextMenu({ hasSelection });
    if (!action) return;
    if (action === EDITOR_ACTIONS.ADD_LINK) {
      const selected = view.state.sliceDoc(from, to);
      const insert = `[[${selected}]]`;
      // Empty selection → cursor between brackets so the user can type the name.
      // Non-empty selection → cursor after the closing ]] so typing continues normally.
      const anchor = selected ? from + insert.length : from + 2;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor },
        scrollIntoView: true,
      });
      view.focus();
      return;
    }
    if (action === EDITOR_ACTIONS.ADD_EXTERNAL_LINK) {
      // Capture {from,to} BEFORE opening the modal — focus leaves the editor.
      const selected = view.state.sliceDoc(from, to);
      const url = await requestUrlRef.current?.();
      if (!url) { view.focus(); return; }
      const v2 = viewRef.current;
      if (!v2) return;
      const text = selected || url;
      const insert = `[${text}](${url})`;
      v2.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
      });
      v2.focus();
    }
  };

  useImperativeHandle(ref, () => ({
    getText: () => viewRef.current?.state.doc.toString() ?? '',
    getViewState: () => {
      const view = viewRef.current;
      if (!view) return null;
      return {
        cursor: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      };
    },
    setContent: (text, viewState) => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      isProgrammaticRef.current = true;
      if (current !== text) {
        view.dispatch({ changes: { from: 0, to: current.length, insert: text } });
      }
      isProgrammaticRef.current = false;
      const len = view.state.doc.length;
      if (viewState) {
        const cursor = Math.min(viewState.cursor ?? 0, len);
        view.dispatch({ selection: { anchor: cursor } });
        requestAnimationFrame(() => {
          view.scrollDOM.scrollTop = viewState.scrollTop ?? 0;
        });
      } else {
        view.dispatch({ selection: { anchor: 0 } });
        requestAnimationFrame(() => { view.scrollDOM.scrollTop = 0; });
      }
    },
    clear: () => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      isProgrammaticRef.current = true;
      view.dispatch({ changes: { from: 0, to: current.length, insert: '' } });
      isProgrammaticRef.current = false;
      view.dispatch({ selection: { anchor: 0 } });
    },
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const completionSource = wikiLinkCompletions(
      () => getPageIndexRef?.current ?? new Map(),
      () => getVaultPathRef?.current ?? null,
    );

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      indentOnInput(),
      indentationMarkers({
        thickness: 1,
        activeThickness: 1,
        markerType: 'codeOnly',
        colors: dark
          ? { dark: '#3a3a3a', activeDark: '#5a5a5a' }
          : { light: '#e0e0e0', activeLight: '#c0c0c0' },
      }),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      taskCheckboxes,
      bulletPoints,
      wikiLinks(
        (name) => linkClickRef.current?.(name),
        () => getPageIndexRef?.current ?? new Map(),
      ),
      autocompletion({
        override: [completionSource],
        activateOnTyping: true,
        maxRenderedOptions: 30,
      }),
      keymap.of([
        indentWithTab,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !isProgrammaticRef.current) {
          changeRef.current?.();
        }
      }),
      EditorView.theme({
        '&': { fontSize: '14px', backgroundColor: 'transparent' },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': {
          overflow: 'visible',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          backgroundColor: 'transparent',
        },
        '.cm-content': { paddingLeft: '4px' },
        '.cm-gutters': { backgroundColor: 'transparent', borderRight: 'none' },
        '.cm-lineNumbers': { paddingLeft: '8px', paddingRight: '12px' },
        // Reserve room for up to 4-digit line numbers so the gutter width doesn't
        // jump when the line count crosses 9→10, 99→100, or 999→1000.
        '.cm-lineNumbers .cm-gutterElement': { minWidth: '4ch', boxSizing: 'content-box' },
      }),
    ];
    if (dark) extensions.push(oneDark);

    const state = EditorState.create({ doc: '', extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  return <div ref={hostRef} className="editor-host" onContextMenu={handleContextMenu} />;
});

export default Editor;

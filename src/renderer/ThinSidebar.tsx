import React, { useEffect, useRef, useState } from 'react';
import { PageIcon, FolderIcon, GraphIcon, CalendarIcon, TemplateIcon } from './Icons.jsx';

export default function ThinSidebar({
  onNewFile,
  onNewFolder,
  onOpenJournal,
  onJournalContextMenu,
  onToggleGraph,
  graphMode,
  templates = [],
  onPickTemplate,
  disabled,
}) {
  // Day-of-month is read on render — no timer. The icon refreshes whenever the
  // parent re-renders (which happens constantly during user activity). If the
  // app sits fully idle across midnight, the day stays stale until any
  // interaction triggers a render. Acceptable for a glyph.
  const todayDay = new Date().getDate();

  const tplWrapRef = useRef<any>(null);
  const [tplOpen, setTplOpen] = useState(false);

  // Close the template popover on outside click / Escape.
  useEffect(() => {
    if (!tplOpen) return;
    const onDown = (e) => {
      if (tplWrapRef.current && !tplWrapRef.current.contains(e.target)) setTplOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setTplOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [tplOpen]);

  return (
    <div className="thin-sidebar">
      <button
        className="thin-sidebar-btn"
        onClick={onNewFile}
        disabled={disabled}
        title="New file"
        aria-label="New file"
      >
        <PageIcon />
      </button>
      <button
        className="thin-sidebar-btn"
        onClick={onOpenJournal}
        onContextMenu={(e) => {
          e.preventDefault();
          if (disabled) return;
          onJournalContextMenu?.(e.clientX, e.clientY);
        }}
        disabled={disabled}
        title="Today's journal (right-click to pick a date)"
        aria-label="Today's journal"
      >
        <CalendarIcon day={todayDay} />
      </button>
      <button
        className="thin-sidebar-btn"
        onClick={onNewFolder}
        disabled={disabled}
        title="New folder"
        aria-label="New folder"
      >
        <FolderIcon />
      </button>
      <div className="thin-sidebar-tpl" ref={tplWrapRef}>
        <button
          className={`thin-sidebar-btn ${tplOpen ? 'active' : ''}`}
          onClick={() => setTplOpen((v) => !v)}
          disabled={disabled}
          title="Insert template"
          aria-label="Insert template"
          aria-haspopup="listbox"
          aria-expanded={tplOpen}
        >
          <TemplateIcon />
        </button>
        {tplOpen && !disabled && (
          <ul className="template-picker" role="listbox">
            {templates.length === 0 ? (
              <li className="template-picker-empty">No templates — set a folder in Settings → Templates</li>
            ) : (
              templates.map((t) => (
                <li
                  key={t.path}
                  role="option"
                  className="template-picker-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setTplOpen(false);
                    onPickTemplate?.(t.path);
                  }}
                >
                  {t.name}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <button
        className={`thin-sidebar-btn ${graphMode ? 'active' : ''}`}
        onClick={onToggleGraph}
        disabled={disabled}
        title={graphMode ? 'Back to editor' : 'Graph view'}
        aria-label="Toggle graph view"
      >
        <GraphIcon />
      </button>
    </div>
  );
}

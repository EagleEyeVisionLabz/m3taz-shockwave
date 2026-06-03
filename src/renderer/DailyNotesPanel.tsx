import React from 'react';
import type { TreeNode } from '../shared/api';

interface DailyNotesPanelProps {
  items: TreeNode[];
  activePath: string | null;
  onOpen: (path: string) => void;
}

// The workspace's daily notes, listed below the bookmarks when bookmark-filter
// mode is on and the Appearance toggle is enabled. Rendered as plain file rows
// (the same `.tree-row` look as the file browser above it) so navigating feels
// identical — just preceded by a section header. Items are pre-filtered (by the
// daily-note format/folder) and pre-sorted (by the active tree sort order) in
// App; this component is presentation only.
export default function DailyNotesPanel({ items, activePath, onOpen }: DailyNotesPanelProps) {
  if (items.length === 0) return null;
  return (
    <div className="daily-notes-section">
      <div className="sidebar-list-header">Daily Notes</div>
      {items.map((it) => (
        <div
          key={it.id}
          className={`tree-row ${it.id === activePath ? 'selected' : ''}`}
          title={it.id}
          onClick={() => onOpen(it.id)}
        >
          <span className="tree-caret" />
          <span className="tree-icon">📄</span>
          <span className="tree-name">{it.name}</span>
        </div>
      ))}
    </div>
  );
}

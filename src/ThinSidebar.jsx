import React from 'react';

export default function ThinSidebar({ onNewNote, onToggleGraph, graphMode, disabled }) {
  return (
    <div className="thin-sidebar">
      <button
        className="thin-sidebar-btn"
        onClick={onNewNote}
        disabled={disabled}
        title="New note"
        aria-label="New note"
      >
        <span aria-hidden="true">＋</span>
      </button>
      <button
        className={`thin-sidebar-btn ${graphMode ? 'active' : ''}`}
        onClick={onToggleGraph}
        disabled={disabled}
        title={graphMode ? 'Back to editor' : 'Graph view'}
        aria-label="Toggle graph view"
      >
        <span aria-hidden="true">◌</span>
      </button>
    </div>
  );
}

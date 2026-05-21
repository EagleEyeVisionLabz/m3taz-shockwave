import React from 'react';

export default function ThinSidebar({ onNewPage, onToggleGraph, graphMode, disabled }) {
  return (
    <div className="thin-sidebar">
      <button
        className="thin-sidebar-btn"
        onClick={onNewPage}
        disabled={disabled}
        title="New page"
        aria-label="New page"
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

import React from 'react';
import { PageIcon, FolderIcon, GraphIcon } from './Icons.jsx';

export default function ThinSidebar({ onNewFile, onNewFolder, onToggleGraph, graphMode, disabled }) {
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
        onClick={onNewFolder}
        disabled={disabled}
        title="New folder"
        aria-label="New folder"
      >
        <FolderIcon />
      </button>
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

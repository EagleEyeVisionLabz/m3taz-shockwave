import React from 'react';

export default function WorkspacesSection({
  workspaces,
  activeWorkspaceId,
  onAdd,
  onSwitch,
  onRemove,
}) {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Workspaces</h2>
      <p className="settings-section-desc">
        Workspaces let you switch between different folders of notes. Each workspace keeps its own
        files and link graph. The folder on disk is never modified by adding or removing a workspace
        from this list.
      </p>

      {workspaces.length === 0 ? (
        <div className="settings-empty">No workspaces yet.</div>
      ) : (
        <ul className="workspace-list">
          {workspaces.map((ws) => (
            <li key={ws.id} className="workspace-row">
              <div className="workspace-meta">
                <div className="workspace-name">
                  {ws.name}
                  {ws.id === activeWorkspaceId && <span className="workspace-active-badge">Active</span>}
                </div>
                <div className="workspace-path" title={ws.path}>{ws.path}</div>
              </div>
              <div className="workspace-actions">
                <button
                  onClick={() => onSwitch(ws.id)}
                  disabled={ws.id === activeWorkspaceId}
                >
                  Open
                </button>
                <button
                  className="workspace-remove"
                  onClick={() => onRemove(ws.id)}
                  aria-label={`Remove ${ws.name}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button className="workspace-add" onClick={onAdd}>+ Add workspace</button>
    </div>
  );
}

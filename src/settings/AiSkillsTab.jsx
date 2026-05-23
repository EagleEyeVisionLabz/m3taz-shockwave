import React, { useCallback, useEffect, useState } from 'react';

// Tri-state value used both for the global toggle ('enabled' | 'disabled') and
// for per-workspace override ('inherit' | 'enabled' | 'disabled').
const GLOBAL_STATES = ['enabled', 'disabled'];
const WORKSPACE_STATES = ['inherit', 'enabled', 'disabled'];

function StateButtons({ states, value, onChange, ariaLabel }) {
  return (
    <div className="skill-state-group" role="radiogroup" aria-label={ariaLabel}>
      {states.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          className={`skill-state-button ${value === s ? 'active' : ''}`}
          onClick={() => onChange(s)}
        >
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  );
}

export default function AiSkillsTab({ skills, onSkillsChange, activeWorkspaceId }) {
  const [installed, setInstalled] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.api.skills.list();
      setInstalled(list);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const globalState = skills?.global ?? {};
  const wsOverrides = (activeWorkspaceId && skills?.workspaces?.[activeWorkspaceId]) || {};

  const setGlobal = useCallback((folderName, value) => {
    const nextGlobal = { ...globalState, [folderName]: value };
    onSkillsChange({ ...skills, global: nextGlobal });
  }, [skills, globalState, onSkillsChange]);

  const setWorkspaceOverride = useCallback((folderName, value) => {
    if (!activeWorkspaceId) return;
    const currentWs = skills?.workspaces?.[activeWorkspaceId] ?? {};
    const nextWs = { ...currentWs };
    if (value === 'inherit') delete nextWs[folderName];
    else nextWs[folderName] = value;
    const nextWorkspaces = { ...(skills?.workspaces ?? {}), [activeWorkspaceId]: nextWs };
    onSkillsChange({ ...skills, workspaces: nextWorkspaces });
  }, [skills, activeWorkspaceId, onSkillsChange]);

  const onImportClick = useCallback(async () => {
    setError(null);
    try {
      const result = await window.api.skills.importPicker();
      if (result) await reload();
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [reload]);

  const onRemove = useCallback(async (skill) => {
    setError(null);
    try {
      await window.api.skills.remove(skill.folderName);
      // Clean up state entries pointing at the removed skill.
      const nextGlobal = { ...globalState };
      delete nextGlobal[skill.folderName];
      const nextWorkspaces = {};
      for (const [wsId, m] of Object.entries(skills?.workspaces ?? {})) {
        const copy = { ...m };
        delete copy[skill.folderName];
        nextWorkspaces[wsId] = copy;
      }
      onSkillsChange({ ...skills, global: nextGlobal, workspaces: nextWorkspaces });
      await reload();
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [skills, globalState, onSkillsChange, reload]);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    setError(null);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    let importedAny = false;
    for (const file of files) {
      const srcPath = window.api.skills.pathForFile(file);
      if (!srcPath) {
        setError('Could not resolve dropped item path. Use the picker instead.');
        continue;
      }
      try {
        await window.api.skills.importFromPath(srcPath);
        importedAny = true;
      } catch (err) {
        setError(err?.message ?? String(err));
      }
    }
    if (importedAny) await reload();
  }, [reload]);

  return (
    <div>
      <p className="settings-field-hint" style={{ marginTop: 0 }}>
        Skills are reusable instructions the AI Agent loads on demand. Drop a folder containing a
        SKILL.md (with <code>name</code> and <code>description</code> in frontmatter) onto the
        area below, or use the picker.
      </p>

      <div
        className={`skill-dropzone ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <span>Drop a skill folder here</span>
        <button type="button" className="skill-dropzone-button" onClick={onImportClick}>
          or choose a folder…
        </button>
      </div>

      {error && <div className="skill-error">{error}</div>}

      <h3 className="settings-subsection-title">Installed skills</h3>
      {loading ? (
        <div className="settings-empty">Loading…</div>
      ) : installed.length === 0 ? (
        <div className="settings-empty">No skills installed yet.</div>
      ) : (
        <ul className="skill-list">
          {installed.map((skill) => {
            const gValue = globalState[skill.folderName] ?? 'disabled';
            const wValue = wsOverrides[skill.folderName] ?? 'inherit';
            return (
              <li key={skill.folderName} className={`skill-row ${skill.hasSkillMd ? '' : 'broken'}`}>
                <div className="skill-info">
                  <div className="skill-name">
                    {skill.name}
                    {!skill.hasSkillMd && <span className="skill-broken-badge">no SKILL.md</span>}
                  </div>
                  {skill.description && <div className="skill-description">{skill.description}</div>}
                  <div className="skill-folder">{skill.folderName}</div>
                </div>
                <div className="skill-controls">
                  <div className="skill-control">
                    <div className="skill-control-label">Global</div>
                    <StateButtons
                      states={GLOBAL_STATES}
                      value={gValue}
                      onChange={(v) => setGlobal(skill.folderName, v)}
                      ariaLabel={`Global state for ${skill.name}`}
                    />
                  </div>
                  <div className="skill-control">
                    <div className="skill-control-label">
                      Workspace{!activeWorkspaceId && ' (none open)'}
                    </div>
                    <StateButtons
                      states={WORKSPACE_STATES}
                      value={activeWorkspaceId ? wValue : 'inherit'}
                      onChange={(v) => setWorkspaceOverride(skill.folderName, v)}
                      ariaLabel={`Workspace override for ${skill.name}`}
                    />
                  </div>
                  <button
                    type="button"
                    className="skill-remove-button"
                    onClick={() => onRemove(skill)}
                    title="Remove skill"
                    aria-label={`Remove ${skill.name}`}
                  >Remove</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="settings-field-hint">
        Changes take effect on the next chat session. Use the chat sidebar's Clear button to start a new session.
      </p>
    </div>
  );
}

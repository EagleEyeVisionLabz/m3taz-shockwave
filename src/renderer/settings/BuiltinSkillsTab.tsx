import React, { useCallback, useEffect, useState } from 'react';

const STATES = ['enabled', 'disabled'];

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

const MAX_DESC_CHARS = 120;
function shortDescription(text) {
  if (!text) return '';
  const periodIdx = text.indexOf('.');
  if (periodIdx >= 0) {
    const sentence = text.slice(0, periodIdx + 1);
    return text.length > sentence.length ? `${sentence} …` : sentence;
  }
  if (text.length > MAX_DESC_CHARS) return `${text.slice(0, MAX_DESC_CHARS).trimEnd()} …`;
  return text;
}

// Built-in skills bundled with the app. Enabled by default; can be turned off,
// but not deleted (they live in the app bundle, not the user's library). Their
// on/off lives in codingAgent.skills.builtin, separate from global skills.
export default function BuiltinSkillsTab({ skills, onSkillsChange }) {
  const [installed, setInstalled] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await window.api.skills.list();
        if (!cancelled) setInstalled(list.filter((s) => s.source === 'builtin'));
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const builtinState = skills?.builtin ?? {};
  const setBuiltin = useCallback((folderName, value) => {
    onSkillsChange({ ...skills, builtin: { ...(skills?.builtin ?? {}), [folderName]: value } });
  }, [skills, onSkillsChange]);

  return (
    <div>
      <p className="settings-tab-intro">
        Skills bundled with the app. Enabled by default — turn one off if you'd rather use your own
        version (add that in Global Skills). Built-in skills can't be deleted.
      </p>

      {error && <div className="skill-error">{error}</div>}

      {loading ? (
        <div className="settings-empty">Loading…</div>
      ) : installed.length === 0 ? (
        <div className="settings-empty">No built-in skills.</div>
      ) : (
        <ul className="skill-list">
          {installed.map((skill) => {
            const value = builtinState[skill.folderName] ?? 'enabled';
            return (
              <li key={skill.folderName} className="skill-row">
                <div className="skill-info">
                  <div className="skill-name">{skill.name}</div>
                  {skill.description && (
                    <div className="skill-description" title={skill.description}>
                      {shortDescription(skill.description)}
                    </div>
                  )}
                  <div className="skill-folder">{skill.folderName}</div>
                </div>
                <div className="skill-controls">
                  <StateButtons
                    states={STATES}
                    value={value}
                    onChange={(v) => setBuiltin(skill.folderName, v)}
                    ariaLabel={`Enable state for ${skill.name}`}
                  />
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

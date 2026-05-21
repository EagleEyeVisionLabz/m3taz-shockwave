import React from 'react';
import { THEME_MODES } from '../constants.js';

const OPTIONS = [
  { value: THEME_MODES.SYSTEM, label: 'System (follow your OS appearance)' },
  { value: THEME_MODES.LIGHT, label: 'Light' },
  { value: THEME_MODES.DARK, label: 'Dark' },
];

export default function AppearanceSection({ themeMode, onChange }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Appearance</h2>
      <p className="settings-section-desc">Choose the color theme.</p>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="theme-mode">Theme</label>
        <select
          id="theme-mode"
          className="settings-select"
          value={themeMode}
          onChange={(e) => onChange(e.target.value)}
        >
          {OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

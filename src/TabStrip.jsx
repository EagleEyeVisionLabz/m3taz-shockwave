import React from 'react';
import { prettyName } from './linkIndex.js';

function shortLabel(path) {
  if (!path) return 'Untitled';
  return prettyName(path).split('/').pop();
}

export default function TabStrip({
  tabs,
  activeTabId,
  vaultPath,
  activeOverrideLabel,
  onSwitch,
  onClose,
  onAdd,
}) {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const label = isActive && activeOverrideLabel
          ? activeOverrideLabel
          : shortLabel(tab.path);
        const tooltip = tab.path ? prettyName(tab.path, vaultPath) : 'New tab';
        return (
          <div
            key={tab.id}
            className={`tab ${isActive ? 'active' : ''}`}
            onClick={() => onSwitch(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            title={tooltip}
          >
            <span className="tab-label">{label}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              aria-label="Close tab"
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="tab-add" onClick={onAdd} aria-label="New tab">+</button>
    </div>
  );
}

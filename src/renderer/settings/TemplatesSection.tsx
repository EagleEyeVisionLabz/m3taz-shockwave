import React from 'react';
import FolderCombobox from './FolderCombobox.jsx';

// Templates settings: pick the folder whose `.md` files are offered in the
// template picker (the double-document icon in the left rail).
export default function TemplatesSection({
  templates,
  onTemplatesChange,
  tree,
  workspacePath,
}) {
  const folder = templates?.folder ?? '';

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Templates</h2>
      <p className="settings-section-desc">
        Choose a folder of Markdown files to use as templates. Pick one from the template button in the left rail to insert it at the cursor (or into a new note when nothing is open).
      </p>

      <div className="settings-field-row">
        <div className="settings-field-text">
          <label className="settings-field-label" htmlFor="templates-folder">Templates folder</label>
          <div className="settings-field-help">Markdown files directly in this folder are listed as templates.</div>
        </div>
        <FolderCombobox
          id="templates-folder"
          value={folder}
          onChange={(next) => onTemplatesChange({ ...templates, folder: next })}
          tree={tree}
          workspacePath={workspacePath}
        />
      </div>
    </div>
  );
}

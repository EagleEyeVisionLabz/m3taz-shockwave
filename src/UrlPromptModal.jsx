import React, { useEffect, useRef, useState } from 'react';

export default function UrlPromptModal({ onSubmit, onCancel }) {
  const [url, setUrl] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Pre-fill if the clipboard already holds a URL — saves the user a paste.
    if (navigator.clipboard?.readText) {
      navigator.clipboard.readText().then((text) => {
        const trimmed = (text ?? '').trim();
        if (/^https?:\/\/\S+$/i.test(trimmed)) {
          setUrl(trimmed);
          requestAnimationFrame(() => inputRef.current?.select());
        }
      }).catch(() => { /* clipboard access denied — fine */ });
    }
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = (e) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className="url-prompt-backdrop" onClick={onCancel}>
      <div className="url-prompt-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <label className="url-prompt-label" htmlFor="url-prompt-input">External link URL</label>
          <input
            id="url-prompt-input"
            ref={inputRef}
            className="url-prompt-input"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            autoComplete="off"
            spellCheck={false}
          />
          <div className="url-prompt-actions">
            <button type="button" className="url-prompt-cancel" onClick={onCancel}>Cancel</button>
            <button type="submit" className="url-prompt-ok" disabled={!url.trim()}>Add link</button>
          </div>
        </form>
      </div>
    </div>
  );
}

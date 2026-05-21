import React, { useEffect, useRef } from 'react';

export default function EditorTitle({ value, onChange, onCommit, conflict }) {
  const inputRef = useRef(null);
  const lastCommittedRef = useRef(value);

  useEffect(() => {
    lastCommittedRef.current = value;
  }, [value]);

  const commit = () => {
    // If there's a name conflict, blurring should revert (matches Obsidian).
    if (conflict) {
      onChange(lastCommittedRef.current);
      return;
    }
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      onChange(lastCommittedRef.current);
      return;
    }
    if (trimmed === lastCommittedRef.current) return;
    onCommit(trimmed);
  };

  const cancel = () => {
    onChange(lastCommittedRef.current);
    inputRef.current?.blur();
  };

  return (
    <input
      ref={inputRef}
      className={`editor-title ${conflict ? 'has-conflict' : ''}`}
      value={value}
      placeholder="Untitled"
      onChange={(e) => onChange(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // With a conflict, keep focus and let the user fix it.
          if (conflict) return;
          inputRef.current?.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      spellCheck={false}
    />
  );
}

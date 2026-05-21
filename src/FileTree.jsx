import React, { useRef, useEffect, useState } from 'react';
import { Tree } from 'react-arborist';
import { FILE_ACTIONS } from './constants.js';

export default function FileTree({ data, onSelect, onRename, onFileAction }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="tree-fill">
      {size.width > 0 && (
        <Tree
          data={data}
          openByDefault={false}
          width={size.width}
          height={size.height}
          indent={16}
          rowHeight={24}
          onSelect={onSelect}
          onRename={onRename}
        >
          {(props) => <Node {...props} onFileAction={onFileAction} />}
        </Tree>
      )}
    </div>
  );
}

function Node({ node, style, dragHandle, onFileAction }) {
  const isFolder = node.isInternal;
  const isMd = !isFolder && node.data.name.toLowerCase().endsWith('.md');

  const handleContextMenu = async (e) => {
    if (!isMd) return;
    e.preventDefault();
    e.stopPropagation();
    const action = await window.api.showFileContextMenu();
    if (!action) return;
    if (action === FILE_ACTIONS.RENAME) {
      node.edit();
    } else if (onFileAction) {
      onFileAction(action, node.id);
    }
  };

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`tree-row ${node.isSelected ? 'selected' : ''}`}
      onClick={() => {
        node.select();
        if (isFolder) node.toggle();
      }}
      onDoubleClick={() => !isFolder && node.edit()}
      onContextMenu={handleContextMenu}
    >
      <span className="tree-caret">
        {isFolder ? (node.isOpen ? '▾' : '▸') : ''}
      </span>
      <span className="tree-icon">{isFolder ? '📁' : '📄'}</span>
      {node.isEditing ? (
        <input
          autoFocus
          defaultValue={node.data.name.replace(/\.md$/i, '')}
          onBlur={() => node.reset()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') node.reset();
            if (e.key === 'Enter') node.submit(e.currentTarget.value);
          }}
          className="tree-rename-input"
        />
      ) : (
        <span className="tree-name">{node.data.name}</span>
      )}
    </div>
  );
}

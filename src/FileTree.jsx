import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Tree } from 'react-arborist';
import { FILE_ACTIONS } from './constants.js';

const FileTree = forwardRef(function FileTree(
  { data, onSelect, onRename, onFileAction, onFolderAction, onMoveItems, disableDrop },
  ref,
) {
  const wrapRef = useRef(null);
  const treeRef = useRef(null);
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

  useImperativeHandle(ref, () => ({
    // Put a node into rename-edit mode. Retries briefly because the node may not be
    // present in the Tree's internal model yet (data prop just updated).
    editNode(id) {
      const tryEdit = (attempt = 0) => {
        const tree = treeRef.current;
        if (tree && tree.get?.(id)) {
          tree.edit(id);
          return;
        }
        if (attempt < 10) requestAnimationFrame(() => tryEdit(attempt + 1));
      };
      tryEdit();
    },
  }), []);

  return (
    <div ref={wrapRef} className="tree-fill">
      {size.width > 0 && (
        <Tree
          ref={treeRef}
          data={data}
          openByDefault={false}
          width={size.width}
          height={size.height}
          indent={16}
          rowHeight={24}
          onSelect={onSelect}
          onRename={onRename}
          onMove={({ dragIds, parentId }) => {
            if (onMoveItems) onMoveItems(dragIds, parentId);
          }}
          disableDrop={disableDrop}
        >
          {(props) => <Node {...props} onFileAction={onFileAction} onFolderAction={onFolderAction} />}
        </Tree>
      )}
    </div>
  );
});

export default FileTree;

function Node({ node, style, dragHandle, onFileAction, onFolderAction }) {
  const isFolder = node.isInternal;
  const isMd = !isFolder && node.data.name.toLowerCase().endsWith('.md');
  const willReceiveDrop = isFolder && node.willReceiveDrop;

  const handleContextMenu = async (e) => {
    if (!isFolder && !isMd) return;
    e.preventDefault();
    e.stopPropagation();

    if (isFolder) {
      const action = await window.api.showFolderContextMenu();
      if (!action) return;
      if (onFolderAction) onFolderAction(action, node.id);
      return;
    }

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
      className={`tree-row ${node.isSelected ? 'selected' : ''} ${willReceiveDrop ? 'drop-target' : ''}`}
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

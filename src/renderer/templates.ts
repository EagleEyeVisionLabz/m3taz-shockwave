import type { TreeNode } from '../shared/api';
import { toRelPath } from './pathUtils.js';

export interface TemplateFile {
  // Basename without `.md` — what the picker / dropdown shows.
  name: string;
  // Absolute path — used to read the template's content on selection.
  path: string;
  // Workspace-relative path — the portable form stored in settings
  // (dailyNote.templatePath). '' workspacePath leaves this equal to path.
  relPath: string;
}

// The `.md` files that are direct children of the configured templates folder
// (non-recursive), sorted alphabetically. `folder` is workspace-relative
// ('' = workspace root). Returns [] when the folder is missing or empty.
export function collectTemplateFiles(tree: TreeNode[], folder: string, workspacePath: string | null): TemplateFile[] {
  const clean = (folder ?? '').replace(/^\/+|\/+$/g, '');
  let nodes: TreeNode[] | undefined = tree;
  if (clean) {
    for (const seg of clean.split('/')) {
      const next = nodes?.find((n) => n.children && n.name === seg);
      if (!next) return [];
      nodes = next.children;
    }
  }
  if (!nodes) return [];
  const out: TemplateFile[] = [];
  for (const n of nodes) {
    if (n.children || !/\.md$/i.test(n.id)) continue;
    out.push({
      name: n.name.replace(/\.md$/i, ''),
      path: n.id,
      relPath: (workspacePath ? toRelPath(n.id, workspacePath) : null) || n.id,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

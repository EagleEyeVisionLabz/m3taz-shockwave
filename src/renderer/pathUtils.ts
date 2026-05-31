// Shared POSIX-style path helpers for the renderer. The renderer always uses
// forward slashes regardless of OS (workspace paths come in this form from
// main, and we keep them that way for link parsing, sidebar drag-drop, etc.).
//
// Don't import node:path here — this module is renderer-only and node:path
// is unavailable behind contextIsolation.

type Maybe = string | null | undefined;

export function basenameOf(p: Maybe): string {
  if (!p) return '';
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

export function dirOf(p: Maybe): string {
  if (!p) return '';
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

// Convert an absolute file path to a workspace-relative POSIX path. Returns
// null when the file isn't inside the workspace (so the caller can skip it).
export function toRelPath(absPath: Maybe, workspacePath: Maybe): string | null {
  if (!workspacePath || !absPath) return null;
  if (absPath === workspacePath) return null;
  const prefix = workspacePath.endsWith('/') ? workspacePath : workspacePath + '/';
  if (!absPath.startsWith(prefix)) return null;
  return absPath.slice(prefix.length);
}

export function toAbsPath(relPath: Maybe, workspacePath: Maybe): string | null {
  if (!workspacePath || !relPath) return null;
  return `${workspacePath}/${relPath}`;
}

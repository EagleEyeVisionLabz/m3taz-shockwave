import { normalizeTarget } from './linkIndex.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function renameWithReferences({
  api,
  linkIndex,
  oldPath,
  newName,
}) {
  const slash = oldPath.lastIndexOf('/');
  const dir = slash >= 0 ? oldPath.slice(0, slash) : '';
  const cleanName = newName.replace(/\.md$/i, '').trim();
  if (!cleanName) throw new Error('Name cannot be empty');
  const newPath = (dir ? `${dir}/` : '') + `${cleanName}.md`;
  if (newPath === oldPath) return newPath;

  const oldBaseName = (slash >= 0 ? oldPath.slice(slash + 1) : oldPath).replace(/\.md$/i, '');
  const targetKey = normalizeTarget(oldBaseName);

  const backlinks = linkIndex.getBacklinks(targetKey);
  const uniqueSources = new Set();
  for (const e of backlinks) uniqueSources.add(e.fromPath);

  const targetEsc = escapeRegex(oldBaseName);
  const linkPattern = new RegExp(
    `\\[\\[(${targetEsc})((?:#[^\\]\\n|]*)?(?:\\|[^\\]\\n]*)?)\\]\\]`,
    'gi'
  );

  for (const src of uniqueSources) {
    if (src === oldPath) continue;
    const content = await api.readFile(src);
    const rewritten = content.replace(linkPattern, `[[${cleanName}$2]]`);
    if (rewritten !== content) {
      await api.writeFile(src, rewritten);
      linkIndex.updateFile(src, rewritten);
    }
  }

  let finalNewPath;
  try {
    finalNewPath = await api.renameFile(oldPath, cleanName);
  } catch (err) {
    throw new Error(`Rename failed: ${err.message ?? err}`);
  }

  linkIndex.renameFile(oldPath, finalNewPath);

  return finalNewPath;
}

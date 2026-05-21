const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { parseLinks } = require('./linkParser');

// Keep in sync with src/constants.js APP_NAME and package.json productName.
const APP_NAME = 'Shockwave';
app.setName(APP_NAME);

const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');

const DEFAULT_SETTINGS = {
  workspaces: [],
  activeWorkspaceId: null,
  appearance: { themeMode: 'system' },
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      appearance: { ...DEFAULT_SETTINGS.appearance, ...(parsed.appearance ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(obj) {
  const file = settingsPath();
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Keep in sync with src/constants.js FILE_ACTIONS.
const FILE_ACTIONS = Object.freeze({
  NEW_TAB: 'newTab',
  DUPLICATE: 'duplicate',
  REVEAL: 'reveal',
  RENAME: 'rename',
  DELETE: 'delete',
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: APP_NAME,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

async function buildTree(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const children = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith('.'))
      .map(async (e) => {
        const fullPath = path.join(dirPath, e.name);
        if (e.isDirectory()) {
          return {
            id: fullPath,
            name: e.name,
            children: await buildTree(fullPath),
          };
        }
        return { id: fullPath, name: e.name };
      })
  );
  children.sort((a, b) => {
    const aDir = !!a.children;
    const bDir = !!b.children;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return children;
}

ipcMain.handle('fs:readTree', async (_evt, dirPath) => {
  return buildTree(dirPath);
});

async function readAllMarkdown(dirPath, out = []) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isSymbolicLink()) continue;
    const full = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      await readAllMarkdown(full, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      try {
        const [content, stat] = await Promise.all([
          fs.readFile(full, 'utf8'),
          fs.stat(full),
        ]);
        const outgoingLinks = parseLinks(content);
        out.push({ path: full, mtime: stat.mtimeMs, outgoingLinks });
      } catch {
        // swallow per-file errors so one bad file doesn't kill the vault load
      }
    }
  }
  return out;
}

ipcMain.handle('fs:readAllMarkdown', async (_evt, dirPath) => {
  return readAllMarkdown(dirPath);
});

ipcMain.handle('fs:readFile', async (_evt, filePath) => {
  return fs.readFile(filePath, 'utf8');
});

ipcMain.handle('fs:writeFile', async (_evt, { filePath, content }) => {
  await fs.writeFile(filePath, content, 'utf8');
});

async function uniquePath(dirPath, base, ext) {
  let candidate = path.join(dirPath, `${base}${ext}`);
  let i = 1;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(dirPath, `${base} ${i}${ext}`);
      i++;
    } catch {
      return candidate;
    }
  }
}

ipcMain.handle('fs:createFile', async (_evt, { dirPath, name, content = '' }) => {
  const ext = name.endsWith('.md') ? '' : '.md';
  const base = ext ? name : name.slice(0, -3);
  const target = await uniquePath(dirPath, base, ext || '.md');
  await fs.writeFile(target, content, 'utf8');
  return target;
});

ipcMain.handle('fs:renameFile', async (_evt, { fromPath, toName }) => {
  const dir = path.dirname(fromPath);
  const finalName = toName.endsWith('.md') ? toName : `${toName}.md`;
  const target = path.join(dir, finalName);
  if (target === fromPath) return target;
  let exists = false;
  try {
    await fs.access(target);
    exists = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (exists) {
    throw new Error(`A file named "${finalName}" already exists in this folder.`);
  }
  await fs.rename(fromPath, target);
  return target;
});

ipcMain.handle('fs:duplicateFile', async (_evt, filePath) => {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const target = await uniquePath(dir, base, ext);
  const content = await fs.readFile(filePath);
  await fs.writeFile(target, content);
  return target;
});

ipcMain.handle('fs:trashFile', async (evt, filePath) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const name = path.basename(filePath);
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Delete file',
    message: `Delete "${name}"?`,
    detail: 'The file will be moved to the Trash.',
    buttons: ['Cancel', 'Delete'],
    defaultId: 0,
    cancelId: 0,
  });
  if (result.response !== 1) return false;
  await shell.trashItem(filePath);
  return true;
});

ipcMain.handle('shell:revealInFolder', async (_evt, filePath) => {
  shell.showItemInFolder(filePath);
});

function revealLabel() {
  if (process.platform === 'darwin') return 'Reveal in Finder';
  if (process.platform === 'win32') return 'Show in Explorer';
  return 'Show in file manager';
}

ipcMain.handle('context:fileMenu', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  return new Promise((resolve) => {
    let chosen = null;
    const menu = Menu.buildFromTemplate([
      { label: 'Open in new tab', click: () => { chosen = FILE_ACTIONS.NEW_TAB; } },
      { label: 'Duplicate', click: () => { chosen = FILE_ACTIONS.DUPLICATE; } },
      { type: 'separator' },
      { label: revealLabel(), click: () => { chosen = FILE_ACTIONS.REVEAL; } },
      { type: 'separator' },
      { label: 'Rename', click: () => { chosen = FILE_ACTIONS.RENAME; } },
      { label: 'Delete', click: () => { chosen = FILE_ACTIONS.DELETE; } },
    ]);
    menu.on('menu-will-close', () => {
      setImmediate(() => resolve(chosen));
    });
    menu.popup({ window: win });
  });
});

ipcMain.handle('settings:read', async () => {
  return readSettings();
});

ipcMain.handle('settings:write', async (_evt, obj) => {
  await writeSettings(obj);
});

ipcMain.handle('fs:pathExists', async (_evt, p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('theme:getInitial', () => ({
  dark: nativeTheme.shouldUseDarkColors,
}));

nativeTheme.on('updated', () => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('theme:systemChanged', {
      dark: nativeTheme.shouldUseDarkColors,
    });
  }
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock?.setIcon) {
    try {
      app.dock.setIcon(ICON_PATH);
    } catch {
      // ignore: icon file may not be present in some dev configurations
    }
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

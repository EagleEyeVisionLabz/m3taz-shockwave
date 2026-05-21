const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readTree: (dirPath) => ipcRenderer.invoke('fs:readTree', dirPath),
  readAllMarkdown: (dirPath) => ipcRenderer.invoke('fs:readAllMarkdown', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) =>
    ipcRenderer.invoke('fs:writeFile', { filePath, content }),
  createFile: (dirPath, name, content) =>
    ipcRenderer.invoke('fs:createFile', { dirPath, name, content }),
  renameFile: (fromPath, toName) =>
    ipcRenderer.invoke('fs:renameFile', { fromPath, toName }),
  duplicateFile: (filePath) => ipcRenderer.invoke('fs:duplicateFile', filePath),
  trashFile: (filePath) => ipcRenderer.invoke('fs:trashFile', filePath),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:revealInFolder', filePath),
  showFileContextMenu: () => ipcRenderer.invoke('context:fileMenu'),
  showEditorContextMenu: (opts) => ipcRenderer.invoke('context:editorMenu', opts),
  pathExists: (p) => ipcRenderer.invoke('fs:pathExists', p),
  watchStart: (dirPath) => ipcRenderer.invoke('fs:watchStart', dirPath),
  watchStop: () => ipcRenderer.invoke('fs:watchStop'),
  onFsChanged: (cb) => {
    const listener = (_evt, payload) => cb(payload);
    ipcRenderer.on('fs:changed', listener);
    return () => ipcRenderer.removeListener('fs:changed', listener);
  },
  settings: {
    read: () => ipcRenderer.invoke('settings:read'),
    write: (obj) => ipcRenderer.invoke('settings:write', obj),
  },
  theme: {
    getInitial: () => ipcRenderer.invoke('theme:getInitial'),
    onSystemChange: (cb) => {
      const listener = (_evt, payload) => cb(payload);
      ipcRenderer.on('theme:systemChanged', listener);
      return () => ipcRenderer.removeListener('theme:systemChanged', listener);
    },
  },
});

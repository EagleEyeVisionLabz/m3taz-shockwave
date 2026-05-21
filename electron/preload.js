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
  pathExists: (p) => ipcRenderer.invoke('fs:pathExists', p),
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

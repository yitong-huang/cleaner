const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cleaner', {
  scan: () => ipcRenderer.invoke('cleaner:scan'),
  clean: (paths) => ipcRenderer.invoke('cleaner:clean', paths),
  scanPhotos: () => ipcRenderer.invoke('cleaner:photos-scan'),
  deletePhotos: (paths) => ipcRenderer.invoke('cleaner:photos-delete', paths),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('cleaner:progress', listener)
    return () => ipcRenderer.removeListener('cleaner:progress', listener)
  },
  platform: process.platform,
})

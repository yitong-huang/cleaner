const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cleaner', {
  scan: () => ipcRenderer.invoke('cleaner:scan'),
  clean: (paths) => ipcRenderer.invoke('cleaner:clean', paths),
  scanPhotos: () => ipcRenderer.invoke('cleaner:photos-scan'),
  deletePhotos: (targets) => ipcRenderer.invoke('cleaner:photos-delete', targets),
  previewPhoto: (filePath) => ipcRenderer.invoke('cleaner:photos-preview', filePath),
  ignorePhotoGroup: (payload) => ipcRenderer.invoke('cleaner:photos-ignore-group', payload),
  getAccessInfo: () => ipcRenderer.invoke('cleaner:access-info'),
  openFullDiskAccess: () => ipcRenderer.invoke('cleaner:open-full-disk-access'),
  revealElectronApp: () => ipcRenderer.invoke('cleaner:reveal-electron-app'),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('cleaner:progress', listener)
    return () => ipcRenderer.removeListener('cleaner:progress', listener)
  },
  platform: process.platform,
})

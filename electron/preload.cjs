const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cleaner', {
  scan: () => ipcRenderer.invoke('cleaner:scan'),
  clean: (paths) => ipcRenderer.invoke('cleaner:clean', paths),
  scanPhotos: () => ipcRenderer.invoke('cleaner:photos-scan'),
  loadPhotoScanCache: () => ipcRenderer.invoke('cleaner:photos-scan-cache-load'),
  savePhotoScanCache: (result) => ipcRenderer.invoke('cleaner:photos-scan-cache-save', result),
  deletePhotos: (targets) => ipcRenderer.invoke('cleaner:photos-delete', targets),
  previewPhoto: (filePath) => ipcRenderer.invoke('cleaner:photos-preview', filePath),
  ignorePhotoGroup: (payload) => ipcRenderer.invoke('cleaner:photos-ignore-group', payload),
  getAccessInfo: () => ipcRenderer.invoke('cleaner:access-info'),
  openFullDiskAccess: () => ipcRenderer.invoke('cleaner:open-full-disk-access'),
  revealElectronApp: () => ipcRenderer.invoke('cleaner:reveal-electron-app'),
  getSettings: () => ipcRenderer.invoke('cleaner:settings-get'),
  setSettings: (patch) => ipcRenderer.invoke('cleaner:settings-set', patch),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('cleaner:progress', listener)
    return () => ipcRenderer.removeListener('cleaner:progress', listener)
  },
  onOpenSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('cleaner:open-settings', listener)
    return () => ipcRenderer.removeListener('cleaner:open-settings', listener)
  },
  platform: process.platform,
})

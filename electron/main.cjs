const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const { Worker } = require('worker_threads')
const { isPhotoPathAllowed, makePreviewDataUrl } = require('./photos.cjs')
const { addIgnoredGroup, loadIgnoredKeys } = require('./photo-ignore.cjs')
const { loadPhotoScanCache, savePhotoScanCache } = require('./photo-scan-cache.cjs')
const { loadSettings, saveSettings } = require('./settings.cjs')
const { deletePhotoTargets } = require('./photos-library.cjs')

const isDev = !app.isPackaged
let mainWindow = null
let activeWorker = null

function getDevElectronAppPath() {
  return path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app')
}

function createWindow() {
  // 撑满当前屏幕可用区域（避开菜单栏/程序坞），不是系统全屏/最大化模式
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea

  mainWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    minWidth: 960,
    minHeight: 680,
    title: 'Cleaner',
    backgroundColor: '#eef3f2',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173')
    if (process.env.CLEANER_DEBUG === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function runWorkerTask(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (activeWorker) {
      reject(new Error('已有任务进行中，请稍候'))
      return
    }

    const worker = new Worker(path.join(__dirname, 'scan-worker.cjs'), {
      workerData: { type, ...payload },
    })
    activeWorker = worker

    const cleanup = () => {
      if (activeWorker === worker) activeWorker = null
    }

    worker.on('message', (message) => {
      if (message?.type === 'progress') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('cleaner:progress', message.progress)
        }
        return
      }
      if (message?.type === 'result') {
        cleanup()
        worker.terminate().catch(() => {})
        resolve(message.result)
        return
      }
      if (message?.type === 'error') {
        cleanup()
        worker.terminate().catch(() => {})
        reject(new Error(message.error?.message || '后台任务失败'))
      }
    })

    worker.on('error', (error) => {
      cleanup()
      reject(error)
    })

    worker.on('exit', (code) => {
      if (activeWorker === worker) {
        cleanup()
        if (code !== 0) reject(new Error(`扫描进程异常退出（${code}）`))
      }
    })
  })
}

async function trashPhotos(targets) {
  const list = Array.isArray(targets) ? targets : []
  const allowed = []
  const skipped = []
  for (const item of list) {
    const filePath = typeof item === 'string' ? item : item?.path
    if (typeof filePath !== 'string' || !isPhotoPathAllowed(filePath)) {
      skipped.push({ path: filePath || String(item), reason: '不在相册允许路径内' })
    } else {
      allowed.push(typeof item === 'string' ? { path: item } : item)
    }
  }

  const result = await deletePhotoTargets(allowed, {
    trashItem: (target) => shell.trashItem(target),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cleaner:progress', progress)
      }
    },
  })

  return {
    ...result,
    skipped: [...skipped, ...(result.skipped || [])],
  }
}

app.whenReady().then(() => {
  app.setName('Cleaner')
  // 菜单栏只保留「Cleaner」：关于、设置（暂空）、退出
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about', label: '关于 Cleaner' },
            { type: 'separator' },
            {
              label: '设置…',
              accelerator: 'Command+,',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('cleaner:open-settings')
                  mainWindow.show()
                  mainWindow.focus()
                }
              },
            },
            { type: 'separator' },
            { role: 'quit', label: '退出 Cleaner' },
          ],
        },
      ]),
    )
  } else {
    Menu.setApplicationMenu(null)
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (activeWorker) {
    activeWorker.terminate().catch(() => {})
    activeWorker = null
  }
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('cleaner:scan', async () => runWorkerTask('scan'))
ipcMain.handle('cleaner:photos-scan', async () => {
  const settings = loadSettings(app.getPath('userData'))
  const result = await runWorkerTask('photos-scan', {
    ignoredKeys: loadIgnoredKeys(app.getPath('userData')),
    similarityLevel: settings.similarityLevel,
  })
  try {
    savePhotoScanCache(app.getPath('userData'), result)
  } catch {
    /* 缓存失败不影响扫描结果返回 */
  }
  return result
})

ipcMain.handle('cleaner:settings-get', async () => loadSettings(app.getPath('userData')))

ipcMain.handle('cleaner:settings-set', async (_event, patch) =>
  saveSettings(app.getPath('userData'), patch),
)

ipcMain.handle('cleaner:photos-scan-cache-load', async () => {
  return loadPhotoScanCache(app.getPath('userData'))
})

ipcMain.handle('cleaner:photos-scan-cache-save', async (_event, result) => {
  return savePhotoScanCache(app.getPath('userData'), result)
})

ipcMain.handle('cleaner:clean', async (_event, paths) => {
  if (!Array.isArray(paths)) throw new Error('paths must be an array')
  return runWorkerTask('clean', { paths })
})

ipcMain.handle('cleaner:photos-delete', async (_event, paths) => {
  if (!Array.isArray(paths)) throw new Error('paths must be an array')
  return trashPhotos(paths)
})

ipcMain.handle('cleaner:photos-preview', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) throw new Error('invalid path')
  if (!isPhotoPathAllowed(filePath)) throw new Error('不在相册允许路径内')
  if (!fs.existsSync(filePath)) throw new Error('文件不存在')
  const dataUrl = makePreviewDataUrl(filePath)
  if (!dataUrl) throw new Error('无法生成预览')
  return { dataUrl }
})

ipcMain.handle('cleaner:photos-ignore-group', async (_event, payload) => {
  const paths = Array.isArray(payload) ? payload : payload?.paths
  const explicitKey = Array.isArray(payload) ? null : payload?.key
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('paths must be a non-empty array')
  for (const p of paths) {
    if (typeof p !== 'string' || !isPhotoPathAllowed(p)) {
      throw new Error('忽略列表包含非法路径')
    }
  }
  const key = addIgnoredGroup(app.getPath('userData'), paths, explicitKey || null)
  return { key }
})

ipcMain.handle('cleaner:access-info', async () => {
  const electronAppPath = getDevElectronAppPath()
  return {
    isDev,
    appName: app.getName(),
    electronAppPath: isDev && fs.existsSync(electronAppPath) ? electronAppPath : null,
    execPath: process.execPath,
  }
})

ipcMain.handle('cleaner:open-full-disk-access', async () => {
  // macOS Ventura+
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
  )
  return { ok: true }
})

ipcMain.handle('cleaner:reveal-electron-app', async () => {
  const electronAppPath = getDevElectronAppPath()
  if (!fs.existsSync(electronAppPath)) {
    throw new Error(`未找到 Electron.app：${electronAppPath}`)
  }
  shell.showItemInFolder(electronAppPath)
  return { ok: true, path: electronAppPath }
})

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { Worker } = require('worker_threads')

const isDev = !app.isPackaged
let mainWindow = null
let activeWorker = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
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

app.whenReady().then(() => {
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

ipcMain.handle('cleaner:clean', async (_event, paths) => {
  if (!Array.isArray(paths)) {
    throw new Error('paths must be an array')
  }
  return runWorkerTask('clean', { paths })
})

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import waitOn from 'wait-on'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteUrl = 'http://127.0.0.1:5173'

// electron 包导出的是 .../Electron.app/Contents/MacOS/Electron
const electronBinary = require('electron')
const electronApp = path.resolve(electronBinary, '..', '..', '..')
const logFile = path.join(os.tmpdir(), 'cleaner-electron-dev.log')

const vite = spawn('npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

let tail = null

function stopElectron() {
  spawnSync('pkill', ['-f', `${electronApp}/Contents/MacOS/Electron`])
}

function shutdown(code = 0) {
  stopElectron()
  tail?.kill('SIGTERM')
  vite.kill('SIGTERM')
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

try {
  await waitOn({ resources: [viteUrl], timeout: 60000 })
} catch (error) {
  console.error('Vite 启动失败', error)
  shutdown(1)
}

fs.writeFileSync(logFile, '')
tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' })

// 经 LaunchServices 启动，macOS 才会按 Electron.app 自身判断「完全磁盘访问权限」，
// 而不是继承启动它的终端（终端没授权时读不了照片图库）。
console.log(`Starting Electron via LaunchServices… (日志: ${logFile})`)
const electron = spawn(
  'open',
  [
    '-W',
    '-n',
    '-a',
    electronApp,
    '--env',
    `VITE_DEV_SERVER_URL=${viteUrl}`,
    '--stdout',
    logFile,
    '--stderr',
    logFile,
    '--args',
    root,
  ],
  { cwd: root, stdio: 'inherit' },
)

electron.on('exit', (code) => {
  shutdown(code ?? 0)
})

vite.on('exit', (code) => {
  if (code && code !== 0) {
    stopElectron()
    process.exit(code)
  }
})

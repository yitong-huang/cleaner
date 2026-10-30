import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import waitOn from 'wait-on'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteUrl = 'http://127.0.0.1:5173'

const vite = spawn('npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

function shutdown(code = 0) {
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

const electronBin = path.join(root, 'node_modules', '.bin', 'electron')
const env = { ...process.env, VITE_DEV_SERVER_URL: viteUrl }
delete env.ELECTRON_RUN_AS_NODE

console.log('Starting Electron…')
const electron = spawn(electronBin, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env,
})

electron.on('exit', (code) => {
  shutdown(code ?? 0)
})

vite.on('exit', (code) => {
  if (code && code !== 0) {
    electron.kill('SIGTERM')
    process.exit(code)
  }
})

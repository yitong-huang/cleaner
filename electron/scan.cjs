const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const HOME = os.homedir()

const SAFE_ROOTS = [
  path.join(HOME, '.cache', 'huggingface'),
  path.join(HOME, 'Library', 'Caches'),
  path.join(HOME, 'Library', 'Logs', 'JetBrains'),
  path.join(HOME, 'Library', 'Application Support', 'JetBrains'),
  path.join(HOME, 'Library', 'Application Support', 'Cursor', 'snapshots'),
  path.join(HOME, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage'),
  path.join(HOME, '.npm'),
  path.join(HOME, '.gradle', 'caches'),
  path.join(HOME, '.m2', 'repository'),
  path.join(HOME, 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport'),
  path.join(HOME, 'Library', 'Developer', 'Xcode', 'DerivedData'),
  path.join(HOME, 'Library', 'Application Support', 'com.netease.mumu.nemux'),
]

const JETBRAINS_PREFIXES = [
  'IntelliJIdea',
  'IdeaIC',
  'PyCharmCE',
  'PyCharm',
  'DataGrip',
  'CLion',
  'WebStorm',
  'GoLand',
  'PhpStorm',
  'RubyMine',
  'Rider',
].sort((a, b) => b.length - a.length)

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function pathSize(target) {
  if (!exists(target)) return 0
  try {
    const result = spawnSync('du', ['-sk', target], { encoding: 'utf8' })
    const lines = (result.stdout || '').trim().split('\n').filter(Boolean)
    if (!lines.length) return 0
    return Number.parseInt(lines[lines.length - 1].split(/\s+/)[0], 10) * 1024
  } catch {
    return 0
  }
}


function installedJetBrainsApps() {
  const apps = '/Applications'
  const mapping = {
    'IntelliJ IDEA.app': 'IntelliJIdea',
    'IntelliJ IDEA CE.app': 'IdeaIC',
    'PyCharm.app': 'PyCharm',
    'PyCharm CE.app': 'PyCharmCE',
    'DataGrip.app': 'DataGrip',
    'CLion.app': 'CLion',
    'WebStorm.app': 'WebStorm',
    'GoLand.app': 'GoLand',
    'PhpStorm.app': 'PhpStorm',
    'RubyMine.app': 'RubyMine',
    'Rider.app': 'Rider',
  }
  const found = new Set()
  for (const [name, prefix] of Object.entries(mapping)) {
    if (exists(path.join(apps, name))) found.add(prefix)
  }
  return found
}

function parseJbDirname(name) {
  for (const prefix of JETBRAINS_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      const version = name.slice(prefix.length)
      if (version && /\d/.test(version[0])) return { prefix, version }
    }
  }
  return null
}

function versionKey(version) {
  return version
    .replace(/-/g, '.')
    .split('.')
    .map((chunk) => Number.parseInt(chunk.replace(/\D/g, ''), 10) || 0)
}

function discoverJetBrainsPaths() {
  const roots = [
    path.join(HOME, 'Library', 'Caches', 'JetBrains'),
    path.join(HOME, 'Library', 'Application Support', 'JetBrains'),
    path.join(HOME, 'Library', 'Logs', 'JetBrains'),
  ]
  const installed = installedJetBrainsApps()
  const byProduct = new Map()

  for (const root of roots) {
    if (!exists(root) || !fs.statSync(root).isDirectory()) continue
    for (const name of fs.readdirSync(root)) {
      const parsed = parseJbDirname(name)
      if (!parsed) continue
      const full = path.join(root, name)
      if (!byProduct.has(parsed.prefix)) byProduct.set(parsed.prefix, [])
      byProduct.get(parsed.prefix).push({ version: parsed.version, path: full })
    }
  }

  const currentPaths = []
  const oldPaths = []

  for (const [prefix, entries] of byProduct.entries()) {
    const versions = [...new Set(entries.map((e) => e.version))].sort((a, b) => {
      const ka = versionKey(a)
      const kb = versionKey(b)
      const len = Math.max(ka.length, kb.length)
      for (let i = 0; i < len; i += 1) {
        const diff = (kb[i] || 0) - (ka[i] || 0)
        if (diff) return diff
      }
      return 0
    })
    const latest = versions[0]
    for (const entry of entries) {
      if (!installed.has(prefix)) {
        oldPaths.push(entry.path)
        continue
      }
      if (entry.version === latest) {
        if (entry.path.includes(`${path.sep}Caches${path.sep}`)) currentPaths.push(entry.path)
      } else {
        oldPaths.push(entry.path)
      }
    }
  }

  return { currentPaths, oldPaths }
}

function scanDefinitions() {
  const cursorGs = path.join(
    HOME,
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'globalStorage',
  )
  const { currentPaths, oldPaths } = discoverJetBrainsPaths()
  const simulatorVolumes = '/Library/Developer/CoreSimulator/Volumes'
  const simulatorAssets =
    '/System/Library/AssetsV2/com_apple_MobileAsset_iOSSimulatorRuntime'

  return [
    {
      id: 'huggingface',
      name: 'Hugging Face 模型缓存',
      category: 'AI / 模型',
      safety: 'safe',
      description: '已下载的模型权重，删除后下次使用会重新下载。',
      paths: [path.join(HOME, '.cache', 'huggingface')],
    },
    {
      id: 'ios-simulator-runtimes',
      name: 'iOS 模拟器运行时',
      category: '开发者',
      safety: 'caution',
      description:
        'Xcode iOS Simulator Runtime。建议在 Xcode → Settings → Platforms 中删除不用的版本。',
      paths: [exists(simulatorVolumes) ? simulatorVolumes : simulatorAssets],
      readonly: true,
    },
    {
      id: 'cursor-state-backup',
      name: 'Cursor 状态库备份',
      category: '编辑器',
      safety: 'safe',
      description: 'state.vscdb.backup，关闭 Cursor 后删除更安全。',
      paths: [path.join(cursorGs, 'state.vscdb.backup')],
    },
    {
      id: 'cursor-snapshots',
      name: 'Cursor 本地快照',
      category: '编辑器',
      safety: 'safe',
      description: 'Agent / 代码库本地快照缓存。',
      paths: [path.join(HOME, 'Library', 'Application Support', 'Cursor', 'snapshots')],
    },
    {
      id: 'pip-cache',
      name: 'pip / Python 缓存',
      category: '开发缓存',
      safety: 'safe',
      description: 'Python 包下载与构建缓存。',
      paths: [
        path.join(HOME, 'Library', 'Caches', 'pip'),
        path.join(HOME, 'Library', 'Caches', 'org.python.python'),
      ],
    },
    {
      id: 'npm-cache',
      name: 'npm 缓存',
      category: '开发缓存',
      safety: 'safe',
      description: 'npm 全局包缓存（_cacache）。',
      paths: [path.join(HOME, '.npm')],
    },
    {
      id: 'jetbrains-caches',
      name: 'JetBrains 当前版本缓存',
      category: 'IDE',
      safety: 'safe',
      description: '仍在使用的 IDE 索引与本地缓存，删除后会自动重建。',
      paths: currentPaths,
    },
    {
      id: 'jetbrains-old',
      name: 'JetBrains 旧版残留',
      category: 'IDE',
      safety: 'safe',
      description: '已卸载产品或旧版本的配置、缓存与日志。',
      paths: oldPaths,
    },
    {
      id: 'gradle-m2',
      name: 'Gradle / Maven 仓库缓存',
      category: '开发缓存',
      safety: 'safe',
      description: '构建依赖本地仓库，删除后下次构建会重新下载。',
      paths: [
        path.join(HOME, '.gradle', 'caches'),
        path.join(HOME, '.m2', 'repository'),
      ],
    },
    {
      id: 'homebrew-cache',
      name: 'Homebrew 缓存',
      category: '开发缓存',
      safety: 'safe',
      description: 'brew 下载的安装包缓存。',
      paths: [path.join(HOME, 'Library', 'Caches', 'Homebrew')],
    },
    {
      id: 'xcode-devicesupport',
      name: 'Xcode 真机调试符号',
      category: '开发者',
      safety: 'caution',
      description: 'iOS DeviceSupport。旧设备符号可删，当前真机调试时会再生成。',
      paths: [path.join(HOME, 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport')],
    },
    {
      id: 'xcode-deriveddata',
      name: 'Xcode DerivedData',
      category: '开发者',
      safety: 'safe',
      description: '编译中间产物，可安全删除。',
      paths: [path.join(HOME, 'Library', 'Developer', 'Xcode', 'DerivedData')],
    },
    {
      id: 'mumu',
      name: '网易 MuMu 模拟器数据',
      category: '应用数据',
      safety: 'caution',
      description: '模拟器虚拟机镜像。不用 MuMu 时可整删。',
      paths: [path.join(HOME, 'Library', 'Application Support', 'com.netease.mumu.nemux')],
    },
    {
      id: 'google-cache',
      name: 'Google / Chrome 缓存',
      category: '应用缓存',
      safety: 'safe',
      description: '浏览器与 Google 相关缓存。',
      paths: [path.join(HOME, 'Library', 'Caches', 'Google')],
    },
    {
      id: 'playwright',
      name: 'Playwright 浏览器缓存',
      category: '开发缓存',
      safety: 'safe',
      description: '自动化测试用浏览器二进制。',
      paths: [path.join(HOME, 'Library', 'Caches', 'ms-playwright')],
    },
    {
      id: 'user-caches-misc',
      name: '其他用户缓存（大项）',
      category: '应用缓存',
      safety: 'safe',
      description: 'Telegram、飞书、Go build、TypeScript 等缓存。',
      paths: [
        path.join(HOME, 'Library', 'Caches', 'ru.keepcoder.Telegram'),
        path.join(HOME, 'Library', 'Caches', 'LarkShell'),
        path.join(HOME, 'Library', 'Caches', 'go-build'),
        path.join(HOME, 'Library', 'Caches', 'typescript'),
        path.join(HOME, 'Library', 'Caches', 'CocoaPods'),
      ],
    },
    {
      id: 'system-diagnostics',
      name: '系统诊断日志',
      category: '系统',
      safety: 'caution',
      description: '系统诊断与 uuidtext。清理需管理员权限，收益有限。',
      paths: ['/private/var/db/diagnostics', '/private/var/db/uuidtext'],
      readonly: true,
    },
  ]
}

function diskInfo() {
  try {
    const out = execFileSync('df', ['-k', '/'], { encoding: 'utf8' })
    const line = out.trim().split('\n').pop()
    const parts = line.split(/\s+/)
    const total = Number(parts[1]) * 1024
    const used = Number(parts[2]) * 1024
    const free = Number(parts[3]) * 1024
    return { total, used, free }
  } catch {
    return { total: 0, used: 0, free: 0 }
  }
}

function buildScan(onProgress) {
  const definitions = scanDefinitions()
  const items = []
  const totalSteps = definitions.length

  definitions.forEach((definition, index) => {
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'scan',
        current: index + 1,
        total: totalSteps,
        label: definition.name,
      })
    }

    const existingPaths = []
    const breakdown = []
    let total = 0
    for (const raw of definition.paths || []) {
      if (!exists(raw)) continue
      const size = pathSize(raw)
      if (size <= 0) continue
      existingPaths.push(raw)
      total += size
      breakdown.push({ path: raw, bytes: size })
    }
    if (total <= 0) return
    items.push({
      id: definition.id,
      name: definition.name,
      category: definition.category,
      safety: definition.safety,
      description: definition.description,
      bytes: total,
      paths: existingPaths,
      breakdown,
      children: [],
      readonly: Boolean(definition.readonly),
      selectedByDefault: definition.safety === 'safe' && !definition.readonly,
    })
  })

  items.sort((a, b) => b.bytes - a.bytes)
  const reclaimableBytes = items
    .filter((i) => !i.readonly)
    .reduce((sum, i) => sum + i.bytes, 0)
  const cautionBytes = items
    .filter((i) => i.safety === 'caution')
    .reduce((sum, i) => sum + i.bytes, 0)
  const safeBytes = items
    .filter((i) => i.safety === 'safe')
    .reduce((sum, i) => sum + i.bytes, 0)

  return {
    scannedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    disk: diskInfo(),
    summary: {
      itemCount: items.length,
      totalBytes: items.reduce((sum, i) => sum + i.bytes, 0),
      safeBytes,
      cautionBytes,
      reclaimableBytes,
    },
    items,
  }
}

function isAllowedDelete(target) {
  let resolved
  try {
    resolved = fs.realpathSync(target)
  } catch {
    resolved = path.resolve(target)
  }
  const cachesRoot = path.join(HOME, 'Library', 'Caches')
  if (resolved === cachesRoot) return false

  return SAFE_ROOTS.some((root) => {
    let rootResolved
    try {
      rootResolved = fs.realpathSync(root)
    } catch {
      rootResolved = path.resolve(root)
    }
    return resolved === rootResolved || resolved.startsWith(`${rootResolved}${path.sep}`)
  })
}

function removePath(target) {
  const stat = fs.lstatSync(target)
  if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true })
  else fs.unlinkSync(target)
}

function cleanPaths(paths, onProgress) {
  const deleted = []
  const skipped = []
  const errors = []
  const list = Array.isArray(paths) ? paths : []

  list.forEach((raw, index) => {
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'clean',
        current: index + 1,
        total: list.length,
        label: raw,
      })
    }
    if (!exists(raw)) {
      skipped.push({ path: raw, reason: '不存在' })
      return
    }
    if (!isAllowedDelete(raw)) {
      skipped.push({ path: raw, reason: '不在允许删除白名单' })
      return
    }
    try {
      const bytes = pathSize(raw)
      removePath(raw)
      deleted.push({ path: raw, bytes })
    } catch (error) {
      errors.push({ path: raw, reason: error.message || String(error) })
    }
  })

  return {
    deleted,
    skipped,
    errors,
    freedBytes: deleted.reduce((sum, item) => sum + item.bytes, 0),
  }
}

module.exports = {
  buildScan,
  cleanPaths,
}

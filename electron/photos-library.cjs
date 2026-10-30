const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { spawnSync, execFile } = require('child_process')

const HOME = os.homedir()
const DEFAULT_LIBRARY = path.join(HOME, 'Pictures', 'Photos Library.photoslibrary')

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function findPhotosLibraryForPath(filePath) {
  const resolved = path.resolve(filePath)
  const marker = '.photoslibrary'
  const idx = resolved.toLowerCase().indexOf(marker)
  if (idx === -1) return null
  return resolved.slice(0, idx + marker.length)
}

function isInsidePhotosLibrary(filePath) {
  return Boolean(findPhotosLibraryForPath(filePath))
}

function toSqliteUri(dbPath) {
  // Photos Library 路径含空格，必须编码，否则 sqlite URI 会打开失败
  return `${pathToFileURL(dbPath).href}?mode=ro&immutable=1`
}

function sqliteQuery(dbPath, sql) {
  if (!exists(dbPath)) {
    throw new Error(`图库数据库不存在：${dbPath}`)
  }

  const uri = toSqliteUri(dbPath)
  let result = spawnSync('sqlite3', ['-readonly', '-separator', '\t', uri, sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  // 部分环境对 file URI 支持不佳时，回退普通只读路径
  if (result.status !== 0) {
    result = spawnSync('sqlite3', ['-readonly', '-separator', '\t', dbPath, sql], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  }

  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim()
    const permissionLike =
      /unable to open|authorization|permission|not permitted|operation not permitted/i.test(err)
    if (permissionLike) {
      const wrapped = new Error(err || '无法打开 Photos.sqlite')
      wrapped.code = 'PHOTOS_DB_PERMISSION'
      throw wrapped
    }
    throw new Error(err || '读取 Photos.sqlite 失败')
  }
  return String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const UUID_RE =
  /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/

function normalizeUuid(value) {
  if (!value) return null
  const text = String(value).trim()
  const matched = text.match(UUID_RE)
  if (matched) return matched[0].toUpperCase()
  const compact = text.replace(/[^0-9A-Fa-f]/g, '')
  if (compact.length === 32) {
    return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`.toUpperCase()
  }
  return null
}

function extractUuidFromName(name) {
  return normalizeUuid(name) || normalizeUuid(String(name).split('_')[0])
}

/**
 * Build maps for path/filename → Photos UUID.
 * Prefer ZDIRECTORY/ZFILENAME matching originals layout.
 */
function loadUuidIndex(libraryPath = DEFAULT_LIBRARY) {
  const dbPath = path.join(libraryPath, 'database', 'Photos.sqlite')
  if (!exists(dbPath)) {
    throw new Error(`未找到图库数据库：${dbPath}`)
  }

  const sql = `
SELECT
  z.ZUUID,
  IFNULL(z.ZDIRECTORY, ''),
  IFNULL(COALESCE(a.ZORIGINALFILENAME, z.ZFILENAME), '')
FROM ZASSET z
LEFT JOIN ZADDITIONALASSETATTRIBUTES a ON a.ZASSET = z.Z_PK
WHERE z.ZTRASHEDSTATE = 0
  AND IFNULL(z.ZHIDDEN, 0) = 0;
`.trim()

  const byRel = new Map()
  const byName = new Map()
  const byUuid = new Map()

  for (const line of sqliteQuery(dbPath, sql)) {
    const [uuidRaw, directory, filename] = line.split('\t')
    const uuid = normalizeUuid(uuidRaw)
    if (!uuid || !filename) continue
    const rel = path.posix.join(String(directory || ''), String(filename))
    byRel.set(rel, uuid)
    byRel.set(rel.toLowerCase(), uuid)
    byName.set(String(filename), uuid)
    byName.set(String(filename).toLowerCase(), uuid)
    byUuid.set(uuid, { directory: String(directory || ''), filename: String(filename) })
  }

  return { libraryPath, byRel, byName, byUuid }
}

function listPhotoAssets(libraryPath = DEFAULT_LIBRARY) {
  const dbPath = path.join(libraryPath, 'database', 'Photos.sqlite')
  if (!exists(dbPath)) {
    throw new Error(`未找到图库数据库：${dbPath}`)
  }

  const sql = `
SELECT
  z.ZUUID,
  IFNULL(z.ZDIRECTORY, ''),
  IFNULL(z.ZFILENAME, ''),
  IFNULL(COALESCE(a.ZORIGINALFILENAME, z.ZFILENAME), ''),
  IFNULL(COALESCE(a.ZORIGINALFILESIZE, 0), 0),
  IFNULL(z.ZKIND, 0),
  IFNULL(z.ZDATECREATED, 0)
FROM ZASSET z
LEFT JOIN ZADDITIONALASSETATTRIBUTES a ON a.ZASSET = z.Z_PK
WHERE z.ZTRASHEDSTATE = 0
  AND IFNULL(z.ZHIDDEN, 0) = 0
  AND IFNULL(z.ZKIND, 0) = 0;
`.trim()

  const assets = []
  for (const line of sqliteQuery(dbPath, sql)) {
    const [uuidRaw, directory, filename, originalName, sizeText, , createdText] = line.split('\t')
    const uuid = normalizeUuid(uuidRaw)
    if (!uuid) continue
    const created = Number(createdText)
    assets.push({
      uuid,
      directory: String(directory || ''),
      filename: String(filename || ''),
      originalName: String(originalName || filename || ''),
      originalBytes: Number(sizeText) || 0,
      // Core Data 时间戳以 2001-01-01 为纪元
      takenAt: created > 0 ? (created + 978307200) * 1000 : 0,
    })
  }
  return assets
}

function walkFiles(root, out, limit = 100000) {
  if (!exists(root) || out.length >= limit) return
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= limit) return
    if (entry.name.startsWith('.')) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) walkFiles(full, out, limit)
    else if (entry.isFile()) out.push(full)
  }
}

/** Largest local derivative/proxy per asset UUID. */
function buildDerivativeIndex(libraryPath = DEFAULT_LIBRARY) {
  const root = path.join(libraryPath, 'resources', 'derivatives')
  const byUuid = new Map()
  if (!exists(root)) return byUuid

  const files = []
  walkFiles(root, files)
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'].includes(ext)) continue
    const uuid = extractUuidFromName(path.basename(filePath, ext))
    if (!uuid) continue
    let size = 0
    try {
      size = fs.statSync(filePath).size
    } catch {
      continue
    }
    const prev = byUuid.get(uuid)
    if (!prev || size > prev.size) byUuid.set(uuid, { path: filePath, size })
  }
  return byUuid
}

function resolveAssetLocalFile(asset, libraryPath, derivativeIndex) {
  const candidates = []
  if (asset.directory && asset.filename) {
    candidates.push(path.join(libraryPath, 'originals', asset.directory, asset.filename))
    candidates.push(path.join(libraryPath, 'Masters', asset.directory, asset.filename))
  }
  if (asset.directory && asset.originalName && asset.originalName !== asset.filename) {
    candidates.push(path.join(libraryPath, 'originals', asset.directory, asset.originalName))
    candidates.push(path.join(libraryPath, 'Masters', asset.directory, asset.originalName))
  }
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return { path: candidate, source: 'original' }
    }
  }
  const derivative = derivativeIndex.get(asset.uuid)
  if (derivative?.path && exists(derivative.path)) {
    return { path: derivative.path, source: 'derivative' }
  }
  return null
}

/**
 * Enumerate Photos library items for scanning.
 * Prefer local originals; fall back to derivatives so iCloud-optimized libraries still work.
 */
function collectLibraryScanItems(libraryPath = DEFAULT_LIBRARY, onProgress) {
  if (!exists(libraryPath)) return []
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'scan', current: 0, total: 0, label: '读取照片图库数据库…' })
  }
  const assets = listPhotoAssets(libraryPath)
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'scan', current: 0, total: 0, label: '索引本地衍生图…' })
  }
  const derivativeIndex = buildDerivativeIndex(libraryPath)
  const items = []
  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i]
    if (typeof onProgress === 'function' && i % 200 === 0) {
      onProgress({
        phase: 'scan',
        current: i + 1,
        total: assets.length,
        label: `匹配本地文件 ${i + 1}/${assets.length}`,
      })
    }
    const local = resolveAssetLocalFile(asset, libraryPath, derivativeIndex)
    if (!local) continue
    let stat
    try {
      stat = fs.statSync(local.path)
    } catch {
      continue
    }
    items.push({
      uuid: asset.uuid,
      path: local.path,
      fileName: asset.originalName || asset.filename || path.basename(local.path),
      bytes: asset.originalBytes > 0 ? asset.originalBytes : stat.size,
      mtime: stat.mtimeMs,
      takenAt: asset.takenAt || 0,
      source: local.source,
    })
  }
  return items
}

function relPathInsideOriginals(filePath, libraryPath) {
  const resolved = path.resolve(filePath)
  const roots = ['originals', 'Masters'].map((name) => path.join(libraryPath, name))
  for (const root of roots) {
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
      return resolved.slice(root.length + 1).split(path.sep).join('/')
    }
  }
  return null
}

function resolveUuidFromPath(filePath, index) {
  const libraryPath = findPhotosLibraryForPath(filePath) || index.libraryPath
  const resolved = path.resolve(filePath)
  const derivativesRoot = path.join(libraryPath, 'resources', 'derivatives')
  if (resolved.startsWith(`${derivativesRoot}${path.sep}`)) {
    const fromName = extractUuidFromName(path.basename(resolved, path.extname(resolved)))
    if (fromName) return fromName
  }
  const rel = relPathInsideOriginals(filePath, libraryPath)
  if (rel) {
    const hit = index.byRel.get(rel) || index.byRel.get(rel.toLowerCase())
    if (hit) return hit
  }
  const base = path.basename(filePath)
  return index.byName.get(base) || index.byName.get(base.toLowerCase()) || null
}

function photosDeleteHelperPath() {
  const candidates = [
    path.join(__dirname, 'bin', 'photos-delete'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'bin', 'photos-delete'),
  ]
  return candidates.find((candidate) => exists(candidate)) || null
}

function runPhotosDeleteHelper(ids, timeoutMs = 5 * 60 * 1000) {
  const helper = photosDeleteHelperPath()
  if (!helper) {
    return Promise.reject(new Error('缺少照片删除组件（electron/bin/photos-delete），请先运行 scripts/build-native.sh'))
  }
  return new Promise((resolve, reject) => {
    execFile(helper, ids, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const line = String(stdout || '')
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter(Boolean)
        .pop()
      if (line) {
        try {
          resolve(JSON.parse(line))
          return
        } catch {
          /* fall through */
        }
      }
      if (error && error.killed) {
        reject(new Error('等待系统删除确认超时，请重试并在弹窗中点「删除」。'))
        return
      }
      reject(new Error(String(stderr || '').trim() || error?.message || '照片删除组件无输出'))
    })
  })
}

/**
 * 「照片」的 AppleScript delete 只支持相簿/文件夹，无法删除照片；
 * 这里改用 PhotoKit（系统会弹确认框），删除后进入「最近删除」并同步 iCloud。
 */
async function deleteMediaItems(entries, { onProgress } = {}) {
  const list = []
  const seen = new Set()
  const ok = []
  const failed = []
  const failures = []

  for (const entry of entries || []) {
    const uuid = normalizeUuid(entry.uuid || entry.photosUuid || entry.id)
    const fileName = entry.fileName || entry.filename || ''
    if (!uuid) {
      if (fileName) {
        const key = `name:${fileName}`
        failed.push(key)
        failures.push({ key, reason: '缺少图库 UUID，无法定位该照片' })
      }
      continue
    }
    if (seen.has(uuid)) continue
    seen.add(uuid)
    list.push({ uuid, fileName })
  }

  if (list.length === 0) return { ok, failed, failures }

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'clean',
      current: 0,
      total: list.length,
      label: `等待系统确认删除 ${list.length} 张（请在弹窗中点「删除」）`,
    })
  }

  let result
  try {
    result = await runPhotosDeleteHelper(list.map((item) => item.uuid))
  } catch (error) {
    for (const item of list) {
      failed.push(item.uuid)
      failures.push({ key: item.uuid, reason: error.message || String(error) })
    }
    return { ok, failed, failures }
  }

  const deletedSet = new Set((result.deleted || []).map((id) => normalizeUuid(id)))
  const missingSet = new Set((result.missing || []).map((id) => normalizeUuid(id)))
  const generalReason =
    result.status === 'denied'
      ? '未获得照片图库权限。请在「系统设置 → 隐私与安全性 → 照片」中允许 Cleaner Photos Helper / Cleaner 完全访问。'
      : result.status === 'cancelled'
        ? '已在系统确认框中取消删除'
        : result.error || '删除失败'

  for (const item of list) {
    if (deletedSet.has(item.uuid)) {
      ok.push(item.uuid)
    } else {
      failed.push(item.uuid)
      failures.push({
        key: item.uuid,
        reason: missingSet.has(item.uuid) ? '在照片图库中找不到该项目（可能已被删除）' : generalReason,
      })
    }
  }

  if (typeof onProgress === 'function') {
    onProgress({ phase: 'clean', current: list.length, total: list.length, label: '删除完成' })
  }

  return { ok, failed, failures }
}

function deleteMediaItemsByUuid(uuids, { onProgress } = {}) {
  return deleteMediaItems(
    (uuids || []).map((uuid) => ({ uuid })),
    { onProgress },
  )
}

/**
 * Delete photos so iCloud Photos syncs the removal.
 * Library assets → Photos.app (Recently Deleted).
 * Loose files under ~/Pictures → Trash.
 *
 * targets: string path | { path, uuid?, bytes? }
 */
async function deletePhotoTargets(targets, { trashItem, onProgress } = {}) {
  const deleted = []
  const skipped = []
  const errors = []
  const list = (Array.isArray(targets) ? targets : [])
    .map((item) => {
      if (typeof item === 'string') return { path: item, uuid: null, bytes: null, fileName: path.basename(item) }
      if (item && typeof item.path === 'string') {
        return {
          path: item.path,
          uuid: normalizeUuid(item.uuid || item.photosUuid) || null,
          bytes: typeof item.bytes === 'number' ? item.bytes : null,
          fileName: item.fileName || path.basename(item.path),
        }
      }
      return null
    })
    .filter(Boolean)

  const libraryItems = []
  const looseItems = []
  for (const item of list) {
    if (isInsidePhotosLibrary(item.path) || item.uuid) libraryItems.push(item)
    else looseItems.push(item)
  }

  const deleteEntries = []
  const keyToMeta = new Map()
  const unresolved = []
  let index = null

  const needsIndex = libraryItems.some((item) => !item.uuid)
  if (needsIndex && libraryItems.length > 0) {
    try {
      if (typeof onProgress === 'function') {
        onProgress({
          phase: 'clean',
          current: 0,
          total: list.length,
          label: '读取图库索引…',
        })
      }
      const libraryPath =
        findPhotosLibraryForPath(libraryItems.find((item) => item.path)?.path || '') ||
        DEFAULT_LIBRARY
      index = loadUuidIndex(libraryPath)
    } catch (error) {
      for (const item of libraryItems.filter((entry) => !entry.uuid)) {
        errors.push({ path: item.path, reason: error.message || String(error) })
      }
    }
  }

  for (let i = 0; i < libraryItems.length; i += 1) {
    const item = libraryItems[i]
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'clean',
        current: i + 1,
        total: list.length,
        label: `解析 ${path.basename(item.path)}`,
      })
    }
    let uuid = item.uuid
    if (!uuid && index) uuid = resolveUuidFromPath(item.path, index)
    if (!uuid && !item.fileName) {
      unresolved.push(item.path)
      continue
    }
    const key = uuid || `name:${item.fileName}`
    if (!keyToMeta.has(key)) {
      keyToMeta.set(key, {
        path: item.path,
        bytes: item.bytes,
        uuid,
        fileName: item.fileName,
      })
      deleteEntries.push({ uuid, fileName: item.fileName })
    }
  }

  for (const raw of unresolved) {
    errors.push({
      path: raw,
      reason: '无法匹配「照片」图库中的项目（缺少 UUID/文件名）',
    })
  }

  if (deleteEntries.length > 0) {
    try {
      const result = await deleteMediaItems(deleteEntries, { onProgress })
      const resolveMeta = (key) =>
        keyToMeta.get(key) ||
        keyToMeta.get(`name:${key}`) ||
        [...keyToMeta.values()].find((entry) => entry.uuid === key || entry.fileName === key)

      for (const key of result.ok) {
        const meta = resolveMeta(key) || { path: key, bytes: null, uuid: key }
        let bytes = meta.bytes || 0
        if (!bytes) {
          try {
            if (meta.path && fs.existsSync(meta.path)) bytes = fs.statSync(meta.path).size
          } catch {
            /* ignore */
          }
        }
        deleted.push({ path: meta.path || key, bytes, uuid: meta.uuid || null, via: 'photos-app' })
      }

      const failureReasonByKey = new Map(
        (result.failures || []).map((entry) => [entry.key, entry.reason]),
      )
      for (const key of result.failed) {
        const meta = resolveMeta(key)
        errors.push({
          path: meta?.path || key,
          reason:
            failureReasonByKey.get(key) ||
            '未能通过「照片」删除该项目。',
        })
      }
    } catch (error) {
      for (const meta of keyToMeta.values()) {
        errors.push({ path: meta.path, reason: error.message || String(error) })
      }
    }
  }

  for (let i = 0; i < looseItems.length; i += 1) {
    const item = looseItems[i]
    const raw = item.path
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'clean',
        current: libraryItems.length + i + 1,
        total: list.length,
        label: path.basename(raw),
      })
    }
    if (!fs.existsSync(raw)) {
      skipped.push({ path: raw, reason: '不存在' })
      continue
    }
    try {
      const bytes = item.bytes || fs.statSync(raw).size
      if (typeof trashItem !== 'function') {
        throw new Error('未提供 trashItem')
      }
      await trashItem(raw)
      deleted.push({ path: raw, bytes, via: 'trash' })
    } catch (error) {
      errors.push({ path: raw, reason: error.message || String(error) })
    }
  }

  return {
    deleted,
    skipped,
    errors,
    freedBytes: deleted.reduce((sum, item) => sum + (item.bytes || 0), 0),
    viaPhotosApp: deleted.some((item) => item.via === 'photos-app'),
  }
}

module.exports = {
  DEFAULT_LIBRARY,
  isInsidePhotosLibrary,
  findPhotosLibraryForPath,
  loadUuidIndex,
  resolveUuidFromPath,
  deleteMediaItemsByUuid,
  deleteMediaItems,
  deletePhotoTargets,
  collectLibraryScanItems,
  normalizeUuid,
}

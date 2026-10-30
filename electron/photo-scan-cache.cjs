const fs = require('fs')
const path = require('path')

const CACHE_VERSION = 1

function cacheFilePath(userDataPath) {
  return path.join(userDataPath, 'photo-scan-cache.json')
}

function isCacheableResult(result) {
  return Boolean(result && typeof result === 'object' && !result.accessError && Array.isArray(result.groups))
}

function loadPhotoScanCache(userDataPath) {
  const file = cacheFilePath(userDataPath)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || raw.version !== CACHE_VERSION) return null
    if (!isCacheableResult(raw.result)) return null
    return {
      result: raw.result,
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : null,
    }
  } catch {
    return null
  }
}

function savePhotoScanCache(userDataPath, result) {
  if (!isCacheableResult(result)) return { ok: false, reason: 'uncacheable' }
  const file = cacheFilePath(userDataPath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const payload = {
    version: CACHE_VERSION,
    savedAt: new Date().toISOString(),
    result,
  }
  // 先写临时文件再替换，避免写到一半崩溃留下坏缓存
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(payload))
  fs.renameSync(tmp, file)
  return { ok: true, savedAt: payload.savedAt }
}

function clearPhotoScanCache(userDataPath) {
  const file = cacheFilePath(userDataPath)
  try {
    fs.unlinkSync(file)
  } catch {
    /* ignore */
  }
  return { ok: true }
}

module.exports = {
  loadPhotoScanCache,
  savePhotoScanCache,
  clearPhotoScanCache,
  isCacheableResult,
}

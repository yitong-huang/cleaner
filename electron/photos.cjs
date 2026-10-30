const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const crypto = require('crypto')

const HOME = os.homedir()
const IMAGE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.heic',
  '.heif',
  '.webp',
  '.tif',
  '.tiff',
  '.gif',
])

const PHOTO_ROOTS = [
  path.join(HOME, 'Pictures', 'Photos Library.photoslibrary', 'originals'),
  path.join(HOME, 'Pictures'),
]

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function walkImages(root, out, limit = 5000) {
  if (!exists(root) || out.length >= limit) return
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= limit) return
    const full = path.join(root, entry.name)
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      if (entry.name.endsWith('.photoslibrary') && root === path.join(HOME, 'Pictures')) continue
      walkImages(full, out, limit)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (IMAGE_EXT.has(ext)) out.push(full)
    }
  }
}

function collectPhotoPaths() {
  const files = []
  const seen = new Set()
  for (const root of PHOTO_ROOTS) {
    if (!exists(root)) continue
    const batch = []
    walkImages(root, batch)
    for (const file of batch) {
      if (seen.has(file)) continue
      seen.add(file)
      files.push(file)
    }
  }
  return files
}

function hamming(a, b) {
  let x = BigInt(a) ^ BigInt(b)
  let count = 0
  while (x > 0n) {
    count += Number(x & 1n)
    x >>= 1n
  }
  return count
}

function dHashFromGray(pixels, width) {
  let hash = 0n
  let bit = 0n
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = pixels[y * width + x]
      const right = pixels[y * width + x + 1]
      if (left > right) hash |= 1n << bit
      bit += 1n
    }
  }
  return hash
}

/** Parse 24-bit BMP (from sips) into grayscale 9x8-ish buffer. */
function grayFromBmp(buf) {
  if (buf.length < 54 || buf.toString('ascii', 0, 2) !== 'BM') return null
  const dataOffset = buf.readUInt32LE(10)
  const width = buf.readInt32LE(18)
  const height = buf.readInt32LE(22)
  const absHeight = Math.abs(height)
  const topDown = height < 0
  if (width < 9 || absHeight < 8) return null
  const rowSize = Math.floor((width * 24 + 31) / 32) * 4
  const gray = new Uint8Array(width * absHeight)
  for (let y = 0; y < absHeight; y += 1) {
    const srcY = topDown ? y : absHeight - 1 - y
    const rowStart = dataOffset + srcY * rowSize
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + x * 3
      const b = buf[i]
      const g = buf[i + 1]
      const r = buf[i + 2]
      gray[y * width + x] = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
    }
  }
  return { gray, width, height: absHeight }
}

function hashImage(filePath, tmpDir) {
  const tmp = path.join(
    tmpDir,
    `${crypto.createHash('md5').update(filePath).digest('hex')}.bmp`,
  )
  const result = spawnSync(
    'sips',
    ['-s', 'format', 'bmp', '-z', '8', '9', filePath, '--out', tmp],
    { encoding: 'utf8' },
  )
  if (result.status !== 0 || !exists(tmp)) return null
  try {
    const parsed = grayFromBmp(fs.readFileSync(tmp))
    if (!parsed) return null
    return dHashFromGray(parsed.gray, parsed.width)
  } catch {
    return null
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

function makeThumbDataUrl(filePath, tmpDir) {
  const tmp = path.join(
    tmpDir,
    `thumb-${crypto.createHash('md5').update(filePath).digest('hex')}.jpg`,
  )
  const result = spawnSync(
    'sips',
    ['-s', 'format', 'jpeg', '-Z', '160', filePath, '--out', tmp],
    { encoding: 'utf8' },
  )
  if (result.status !== 0 || !exists(tmp)) return null
  try {
    const buf = fs.readFileSync(tmp)
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

function clusterByHash(items, threshold = 10) {
  const groups = []
  const used = new Set()
  for (let i = 0; i < items.length; i += 1) {
    if (used.has(i)) continue
    const group = [items[i]]
    used.add(i)
    for (let j = i + 1; j < items.length; j += 1) {
      if (used.has(j)) continue
      if (hamming(items[i].hash, items[j].hash) <= threshold) {
        group.push(items[j])
        used.add(j)
      }
    }
    groups.push(group)
  }
  return groups
}

function buildPhotoScan(onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-photos-'))
  try {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'scan', current: 0, total: 0, label: '收集相册文件…' })
    }

    const library = path.join(HOME, 'Pictures', 'Photos Library.photoslibrary')
    const files = collectPhotoPaths()

    if (files.length === 0) {
      const hint = exists(library)
        ? '检测到照片图库，但无法读取文件。请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中允许 Cleaner 后重试。'
        : '未找到可扫描的照片。默认扫描 ~/Pictures 与系统「照片」图库。'
      return {
        scannedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        accessError: hint,
        summary: {
          photoCount: 0,
          groupCount: 0,
          similarGroupCount: 0,
          similarPhotoCount: 0,
          totalBytes: 0,
          reclaimableBytes: 0,
        },
        groups: [],
      }
    }

    const hashed = []
    for (let i = 0; i < files.length; i += 1) {
      const filePath = files[i]
      if (typeof onProgress === 'function') {
        onProgress({
          phase: 'scan',
          current: i + 1,
          total: files.length,
          label: path.basename(filePath),
        })
      }
      let stat
      try {
        stat = fs.statSync(filePath)
      } catch {
        continue
      }
      const hash = hashImage(filePath, tmpDir)
      if (hash == null) continue
      hashed.push({
        id: crypto.createHash('md5').update(filePath).digest('hex'),
        path: filePath,
        fileName: path.basename(filePath),
        bytes: stat.size,
        mtime: stat.mtimeMs,
        hash,
      })
    }

    const clusters = clusterByHash(hashed, 10)
    const similar = clusters
      .filter((g) => g.length >= 2)
      .sort((a, b) => {
        const ba = a.reduce((s, p) => s + p.bytes, 0)
        const bb = b.reduce((s, p) => s + p.bytes, 0)
        return bb - ba
      })

    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'scan',
        current: files.length,
        total: files.length,
        label: '生成缩略图…',
      })
    }

    const groups = similar.map((photos, index) => {
      const sorted = [...photos].sort((a, b) => b.bytes - a.bytes || b.mtime - a.mtime)
      const withThumbs = sorted.map((photo, photoIndex) => ({
        id: photo.id,
        path: photo.path,
        fileName: photo.fileName,
        bytes: photo.bytes,
        mtime: photo.mtime,
        thumbDataUrl: makeThumbDataUrl(photo.path, tmpDir),
        keepSuggested: photoIndex === 0,
      }))
      return {
        id: `group-${index}`,
        count: withThumbs.length,
        bytes: withThumbs.reduce((s, p) => s + p.bytes, 0),
        reclaimableBytes: withThumbs.slice(1).reduce((s, p) => s + p.bytes, 0),
        photos: withThumbs,
      }
    })

    return {
      scannedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      accessError: null,
      summary: {
        photoCount: hashed.length,
        groupCount: clusters.length,
        similarGroupCount: groups.length,
        similarPhotoCount: groups.reduce((s, g) => s + g.count, 0),
        totalBytes: hashed.reduce((s, p) => s + p.bytes, 0),
        reclaimableBytes: groups.reduce((s, g) => s + g.reclaimableBytes, 0),
      },
      groups,
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function isPhotoPathAllowed(target) {
  let resolved
  try {
    resolved = fs.realpathSync(target)
  } catch {
    resolved = path.resolve(target)
  }
  const pictures = path.join(HOME, 'Pictures')
  return resolved === pictures || resolved.startsWith(`${pictures}${path.sep}`)
}

module.exports = {
  buildPhotoScan,
  isPhotoPathAllowed,
}

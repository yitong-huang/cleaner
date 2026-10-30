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

const { groupKeyFromIds } = require('./photo-ignore.cjs')
const {
  DEFAULT_LIBRARY,
  collectLibraryScanItems,
} = require('./photos-library.cjs')

const PICTURES = path.join(HOME, 'Pictures')
function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function walkLooseImages(root, out, limit = 20000) {
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
      if (entry.name.endsWith('.photoslibrary')) continue
      walkLooseImages(full, out, limit)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (IMAGE_EXT.has(ext)) out.push(full)
    }
  }
}

function discoverPhotoLibraries() {
  const libraries = []
  const seen = new Set()
  const add = (p) => {
    if (!p || seen.has(p) || !exists(p)) return
    seen.add(p)
    libraries.push(p)
  }
  add(DEFAULT_LIBRARY)
  if (exists(PICTURES)) {
    let entries = []
    try {
      entries = fs.readdirSync(PICTURES, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.photoslibrary')) {
        add(path.join(PICTURES, entry.name))
      }
    }
  }
  return libraries
}

function collectScanCandidates(onProgress) {
  const items = []
  const seenPaths = new Set()
  const seenUuids = new Set()
  let libraryAssetCount = 0
  let originalCount = 0
  let derivativeCount = 0
  let libraryReadError = null
  let libraryReadErrorCode = null

  for (const library of discoverPhotoLibraries()) {
    try {
      const libraryItems = collectLibraryScanItems(library, onProgress)
      libraryAssetCount += libraryItems.length
      for (const item of libraryItems) {
        if (seenUuids.has(item.uuid) || seenPaths.has(item.path)) continue
        seenUuids.add(item.uuid)
        seenPaths.add(item.path)
        if (item.source === 'original') originalCount += 1
        else derivativeCount += 1
        items.push({
          id: item.uuid,
          photosUuid: item.uuid,
          path: item.path,
          fileName: item.fileName,
          bytes: item.bytes,
          mtime: item.mtime,
          takenAt: item.takenAt || 0,
          source: item.source,
        })
      }
    } catch (error) {
      libraryReadError = error.message || String(error)
      libraryReadErrorCode =
        error.code ||
        (/unable to open|not permitted|authorization/i.test(libraryReadError)
          ? 'PHOTOS_DB_PERMISSION'
          : null)
    }
  }

  const loose = []
  walkLooseImages(PICTURES, loose)
  for (const filePath of loose) {
    if (seenPaths.has(filePath)) continue
    seenPaths.add(filePath)
    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }
    items.push({
      id: crypto.createHash('md5').update(filePath).digest('hex'),
      photosUuid: null,
      path: filePath,
      fileName: path.basename(filePath),
      bytes: stat.size,
      mtime: stat.mtimeMs,
      takenAt: stat.mtimeMs,
      source: 'file',
    })
  }

  return {
    items,
    libraryAssetCount,
    originalCount,
    derivativeCount,
    looseCount: items.filter((item) => item.source === 'file').length,
    libraryReadError,
    libraryReadErrorCode,
  }
}

function pop32(x) {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/** 64 位哈希以两个 uint32 存储。 */
function hamming64(a, b) {
  return pop32((a[0] ^ b[0]) >>> 0) + pop32((a[1] ^ b[1]) >>> 0)
}

function bitsToHash(bits) {
  const hash = [0, 0]
  for (let i = 0; i < 64; i += 1) {
    if (bits[i]) hash[i >> 5] = (hash[i >> 5] | (1 << (i & 31))) >>> 0
  }
  return hash
}

function dHashFromGray9x8(pixels) {
  // pixels: 9 wide x 8 tall
  const bits = []
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits.push(pixels[y * 9 + x] > pixels[y * 9 + x + 1])
    }
  }
  return bitsToHash(bits)
}

const DCT_N = 32
const DCT_COS = (() => {
  const table = new Float64Array(DCT_N * DCT_N)
  for (let u = 0; u < DCT_N; u += 1) {
    for (let x = 0; x < DCT_N; x += 1) {
      table[u * DCT_N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_N))
    }
  }
  return table
})()

/** pHash：32×32 灰度做 DCT，取低频 8×8（去掉直流分量）与中位数比较。 */
function pHashFromGray32(pixels) {
  const rows = new Float64Array(DCT_N * 8)
  for (let y = 0; y < DCT_N; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0
      for (let x = 0; x < DCT_N; x += 1) sum += pixels[y * DCT_N + x] * DCT_COS[u * DCT_N + x]
      rows[y * 8 + u] = sum
    }
  }
  const coeffs = new Float64Array(64)
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0
      for (let y = 0; y < DCT_N; y += 1) sum += rows[y * 8 + u] * DCT_COS[v * DCT_N + y]
      coeffs[v * 8 + u] = sum
    }
  }
  const ac = Array.from(coeffs.slice(1)).sort((a, b) => a - b)
  const median = ac[Math.floor(ac.length / 2)]
  const bits = []
  for (let i = 0; i < 64; i += 1) bits.push(i === 0 ? false : coeffs[i] > median)
  return bitsToHash(bits)
}

function grayStats(pixels) {
  if (!pixels.length) return { mean: 0, variance: 0 }
  let sum = 0
  for (let i = 0; i < pixels.length; i += 1) sum += pixels[i]
  const mean = sum / pixels.length
  let varSum = 0
  for (let i = 0; i < pixels.length; i += 1) {
    const d = pixels[i] - mean
    varSum += d * d
  }
  return { mean, variance: varSum / pixels.length }
}

/** Parse 24-bit BMP (from sips) into grayscale buffer. */
function grayFromBmp(buf) {
  if (buf.length < 54 || buf.toString('ascii', 0, 2) !== 'BM') return null
  const dataOffset = buf.readUInt32LE(10)
  const width = buf.readInt32LE(18)
  const height = buf.readInt32LE(22)
  const absHeight = Math.abs(height)
  const topDown = height < 0
  if (width < 9 || absHeight < 8) return null
  const bitCount = buf.readUInt16LE(28)
  if (bitCount !== 24 && bitCount !== 32) return null
  const bytesPerPixel = bitCount / 8
  const rowSize = Math.floor((width * bitCount + 31) / 32) * 4
  const gray = new Uint8Array(width * absHeight)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (let y = 0; y < absHeight; y += 1) {
    const srcY = topDown ? y : absHeight - 1 - y
    const rowStart = dataOffset + srcY * rowSize
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + x * bytesPerPixel
      const b = buf[i]
      const g = buf[i + 1]
      const r = buf[i + 2]
      sumR += r
      sumG += g
      sumB += b
      gray[y * width + x] = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
    }
  }
  const count = width * absHeight
  return {
    gray,
    width,
    height: absHeight,
    color: [sumR / count, sumG / count, sumB / count],
  }
}

function resizeGrayBox(gray, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH)
  for (let y = 0; y < dstH; y += 1) {
    const y0 = Math.floor((y * srcH) / dstH)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / dstH))
    for (let x = 0; x < dstW; x += 1) {
      const x0 = Math.floor((x * srcW) / dstW)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / dstW))
      let sum = 0
      let count = 0
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          sum += gray[yy * srcW + xx]
          count += 1
        }
      }
      out[y * dstW + x] = Math.round(sum / count)
    }
  }
  return out
}

function hashImage(filePath, tmpDir) {
  const tmp = path.join(
    tmpDir,
    `${crypto.createHash('md5').update(filePath).digest('hex')}.bmp`,
  )
  // 先缩到较大边长再自行采样，避免直接 8x9 把不同内容糊成相近哈希
  const result = spawnSync(
    'sips',
    ['-s', 'format', 'bmp', '-Z', '96', filePath, '--out', tmp],
    { encoding: 'utf8' },
  )
  if (result.status !== 0 || !exists(tmp)) return null
  try {
    const parsed = grayFromBmp(fs.readFileSync(tmp))
    if (!parsed) return null
    const { variance } = grayStats(parsed.gray)
    // 过糊/近似纯色的图（常见于失败衍生图）不参与相似分组
    if (variance < 18) return null
    const { gray, width, height } = parsed
    return {
      dHash: dHashFromGray9x8(resizeGrayBox(gray, width, height, 9, 8)),
      pHash: pHashFromGray32(resizeGrayBox(gray, width, height, DCT_N, DCT_N)),
      aspect: width / height,
      color: parsed.color,
    }
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

function makeImageDataUrl(filePath, maxEdge, tmpDir) {
  const tmp = path.join(
    tmpDir,
    `img-${maxEdge}-${crypto.createHash('md5').update(filePath).digest('hex')}.jpg`,
  )
  const result = spawnSync(
    'sips',
    ['-s', 'format', 'jpeg', '-Z', String(maxEdge), filePath, '--out', tmp],
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

function makeThumbDataUrl(filePath, tmpDir) {
  return makeImageDataUrl(filePath, 160, tmpDir)
}

function makePreviewDataUrl(filePath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-preview-'))
  try {
    return makeImageDataUrl(filePath, 1400, tmpDir)
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

const BURST_WINDOW_MS = 90 * 1000
const SIMILARITY = {
  // 任意时间：几乎相同（重复导入、导出副本、轻微压缩）
  duplicate: { pHash: 6, dHash: 8, color: 28 },
  // 同一场景连拍：允许轻微构图/表情变化
  burst: { pHash: 12, dHash: 14, color: 36 },
  aspectTolerance: 0.06,
}

function colorDistance(a, b) {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function isSimilarPhoto(a, b) {
  const aspectGap = Math.abs(a.hash.aspect - b.hash.aspect) / Math.max(a.hash.aspect, b.hash.aspect)
  if (aspectGap > SIMILARITY.aspectTolerance) return false

  const p = hamming64(a.hash.pHash, b.hash.pHash)
  if (p > SIMILARITY.burst.pHash) return false
  const d = hamming64(a.hash.dHash, b.hash.dHash)
  if (d > SIMILARITY.burst.dHash) return false
  const c = colorDistance(a.hash.color, b.hash.color)

  const strict = SIMILARITY.duplicate
  if (p <= strict.pHash && d <= strict.dHash && c <= strict.color) return true

  const sameMoment =
    a.takenAt > 0 && b.takenAt > 0 && Math.abs(a.takenAt - b.takenAt) <= BURST_WINDOW_MS
  return sameMoment && c <= SIMILARITY.burst.color
}

/**
 * 近重复分组：候选必须与组内每一张都相似（全连接），
 * 避免“都像种子图、彼此不像”的松散大组。
 */
function clusterByHash(items, onProgress) {
  const groups = []
  const used = new Set()
  const total = items.length
  let processed = 0
  let lastReportAt = 0
  for (let i = 0; i < items.length; i += 1) {
    if (used.has(i)) continue
    const members = [items[i]]
    used.add(i)
    for (let j = i + 1; j < items.length; j += 1) {
      if (used.has(j)) continue
      const candidate = items[j]
      if (!members.every((member) => isSimilarPhoto(member, candidate))) continue
      members.push(candidate)
      used.add(j)
    }
    groups.push(members)
    processed += members.length
    if (typeof onProgress === 'function' && (processed - lastReportAt >= 200 || processed >= total)) {
      lastReportAt = processed
      onProgress({
        phase: 'scan',
        current: processed,
        total,
        label: '比对感知哈希，合并相似组…',
      })
    }
  }
  return groups
}

function buildPhotoScan(onProgress, options = {}) {
  const ignoredKeys = new Set(
    Array.isArray(options.ignoredKeys) ? options.ignoredKeys.filter((k) => typeof k === 'string') : [],
  )
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-photos-'))
  try {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'scan', current: 0, total: 0, label: '收集相册文件…' })
    }

    const library = DEFAULT_LIBRARY
    const collected = collectScanCandidates(onProgress)
    const files = collected.items

    if (files.length === 0) {
      let hint
      let accessHelp = null
      if (collected.libraryReadError) {
        accessHelp = {
          code: collected.libraryReadErrorCode || 'PHOTOS_DB_ERROR',
          detail: collected.libraryReadError,
        }
        hint =
          collected.libraryReadErrorCode === 'PHOTOS_DB_PERMISSION'
            ? '无法读取「照片」图库数据库。开发模式下请把 Electron.app 加到「完全磁盘访问权限」（列表里通常不叫 Cleaner）。'
            : `无法读取照片图库：${collected.libraryReadError}`
      } else if (exists(library)) {
        hint =
          '检测到照片图库，但找不到可分析的本地原图/衍生图。若刚开启权限，请完全退出应用后重试。'
        accessHelp = { code: 'PHOTOS_DB_PERMISSION', detail: null }
      } else {
        hint = '未找到可扫描的照片。默认扫描系统「照片」图库与 ~/Pictures。'
      }
      return {
        scannedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        accessError: hint,
        accessHelp,
        note: null,
        summary: {
          discoveredCount: 0,
          photoCount: 0,
          hashFailedCount: 0,
          originalCount: 0,
          derivativeCount: 0,
          groupCount: 0,
          similarGroupCount: 0,
          similarPhotoCount: 0,
          ignoredGroupCount: 0,
          totalBytes: 0,
          reclaimableBytes: 0,
        },
        groups: [],
      }
    }

    const hashed = []
    let hashFailedCount = 0
    for (let i = 0; i < files.length; i += 1) {
      const item = files[i]
      if (typeof onProgress === 'function') {
        onProgress({
          phase: 'scan',
          current: i + 1,
          total: files.length,
          label: `计算感知哈希 · ${item.fileName}`,
        })
      }
      const hash = hashImage(item.path, tmpDir)
      if (hash == null) {
        hashFailedCount += 1
        continue
      }
      hashed.push({
        ...item,
        hash,
      })
    }

    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'scan',
        current: 0,
        total: hashed.length,
        label: '比对感知哈希，合并相似组…',
      })
    }

    // 按拍摄时间排序，让连拍在聚类时先相遇
    hashed.sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0))
    const clusters = clusterByHash(hashed, onProgress)
    const similarAll = clusters
      .filter((g) => g.length >= 2)
      .sort((a, b) => {
        const ba = a.reduce((s, p) => s + p.bytes, 0)
        const bb = b.reduce((s, p) => s + p.bytes, 0)
        return bb - ba
      })

    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'scan',
        current: 0,
        total: 0,
        label: '筛选已忽略的相似组…',
      })
    }

    let ignoredGroupCount = 0
    const similar = []
    for (const group of similarAll) {
      const key = groupKeyFromIds(group.map((p) => p.photosUuid || p.path))
      if (ignoredKeys.has(key)) {
        ignoredGroupCount += 1
        continue
      }
      similar.push({ photos: group, key })
    }

    const thumbTotal = similar.reduce((sum, g) => sum + g.photos.length, 0)
    let thumbDone = 0
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'scan',
        current: 0,
        total: thumbTotal,
        label: '生成相似组缩略图…',
      })
    }

    const groups = similar.map(({ photos, key }, index) => {
      const sorted = [...photos].sort((a, b) => b.bytes - a.bytes || b.mtime - a.mtime)
      const withThumbs = sorted.map((photo, photoIndex) => {
        thumbDone += 1
        if (typeof onProgress === 'function' && (thumbDone % 8 === 0 || thumbDone >= thumbTotal)) {
          onProgress({
            phase: 'scan',
            current: thumbDone,
            total: thumbTotal,
            label: '生成相似组缩略图…',
          })
        }
        return {
          id: photo.id,
          path: photo.path,
          fileName: photo.fileName,
          bytes: photo.bytes,
          mtime: photo.mtime,
          photosUuid: photo.photosUuid,
          source: photo.source,
          thumbDataUrl: makeThumbDataUrl(photo.path, tmpDir),
          keepSuggested: photoIndex === 0,
        }
      })
      return {
        id: `group-${index}`,
        key,
        count: withThumbs.length,
        bytes: withThumbs.reduce((s, p) => s + p.bytes, 0),
        reclaimableBytes: withThumbs.slice(1).reduce((s, p) => s + p.bytes, 0),
        photos: withThumbs,
      }
    })

    const hashedOriginals = hashed.filter((p) => p.source === 'original').length
    const hashedDerivatives = hashed.filter((p) => p.source === 'derivative').length
    return {
      scannedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      accessError: null,
      accessHelp: null,
      note: exists(library)
        ? `相似组同时比对 pHash、dHash、宽高比与色调：几乎相同的副本任意时间都会归组，90 秒内的连拍允许轻微差异。优先本地原图，缺失时用衍生图；删除经「照片」同步 iCloud。本次原图 ${hashedOriginals} 张，衍生图 ${hashedDerivatives} 张。`
        : null,
      summary: {
        discoveredCount: files.length,
        photoCount: hashed.length,
        hashFailedCount,
        originalCount: hashedOriginals,
        derivativeCount: hashedDerivatives,
        groupCount: clusters.length,
        similarGroupCount: groups.length,
        similarPhotoCount: groups.reduce((s, g) => s + g.count, 0),
        ignoredGroupCount,
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
  makePreviewDataUrl,
}

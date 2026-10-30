import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  cleanPaths,
  deletePhotos,
  fetchPhotoScan,
  fetchScan,
  ignorePhotoGroup,
  onProgress,
  openFullDiskAccess,
  previewPhoto,
  revealElectronApp,
  type ProgressInfo,
} from './api'
import { formatBytes, percent } from './format'
import type { AppMode, PhotoAccessHelp, PhotoScanResult, ScanItem, ScanResult } from './types'
import './App.css'

type GroupPreviewMap = Record<string, { dataUrl: string | null; loading: boolean; error: string | null }>

type Filter = 'all' | 'safe' | 'caution'

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  '#8eb9b0',
  '#3d5c58',
  '#a8c5bf',
]

function safetyLabel(safety: ScanItem['safety']) {
  return safety === 'safe' ? '可安全删除' : safety === 'caution' ? '需确认' : '保留'
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('system')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [photoScan, setPhotoScan] = useState<PhotoScanResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [photoSelected, setPhotoSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accessHelp, setAccessHelp] = useState<PhotoAccessHelp | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressInfo | null>(null)
  const [groupViewerIndex, setGroupViewerIndex] = useState<number | null>(null)
  const [groupPreviews, setGroupPreviews] = useState<GroupPreviewMap>({})
  const [viewerImageSizes, setViewerImageSizes] = useState<Record<string, { w: number; h: number }>>(
    {},
  )

  useEffect(() => onProgress(setProgress), [])

  const viewingGroup =
    groupViewerIndex != null && photoScan ? photoScan.groups[groupViewerIndex] ?? null : null

  const viewerOrientation = useMemo(() => {
    const sizes = Object.values(viewerImageSizes)
    if (sizes.length === 0) return 'landscape'
    const landscapeCount = sizes.filter((size) => size.w >= size.h).length
    return landscapeCount >= sizes.length / 2 ? 'landscape' : 'portrait'
  }, [viewerImageSizes])

  useEffect(() => {
    if (groupViewerIndex == null || !photoScan) return
    if (groupViewerIndex >= photoScan.groups.length) {
      if (photoScan.groups.length === 0) setGroupViewerIndex(null)
      else setGroupViewerIndex(photoScan.groups.length - 1)
    }
  }, [groupViewerIndex, photoScan])

  useEffect(() => {
    if (!viewingGroup) {
      setGroupPreviews({})
      setViewerImageSizes({})
      return
    }
    setViewerImageSizes({})

    const photos = viewingGroup.photos
    let cancelled = false
    const initial: GroupPreviewMap = {}
    for (const photo of photos) {
      initial[photo.id] = {
        dataUrl: photo.thumbDataUrl,
        loading: true,
        error: null,
      }
    }
    setGroupPreviews(initial)

    ;(async () => {
      await Promise.all(
        photos.map(async (photo) => {
          try {
            const result = await previewPhoto(photo.path)
            if (cancelled) return
            setGroupPreviews((prev) => ({
              ...prev,
              [photo.id]: { dataUrl: result.dataUrl, loading: false, error: null },
            }))
          } catch (err) {
            if (cancelled) return
            setGroupPreviews((prev) => ({
              ...prev,
              [photo.id]: {
                dataUrl: photo.thumbDataUrl,
                loading: false,
                error: err instanceof Error ? err.message : '预览失败',
              },
            }))
          }
        }),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [viewingGroup?.id])

  useEffect(() => {
    if (groupViewerIndex == null || !photoScan) return
    const index = groupViewerIndex
    const total = photoScan.groups.length
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setGroupViewerIndex(null)
      if (event.key === 'ArrowLeft' && index > 0) setGroupViewerIndex(index - 1)
      if (event.key === 'ArrowRight' && index < total - 1) setGroupViewerIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [groupViewerIndex, photoScan])

  const visibleItems = useMemo(() => {
    if (!scan) return []
    if (filter === 'all') return scan.items
    return scan.items.filter((item) => item.safety === filter)
  }, [scan, filter])

  const selectedBytes = useMemo(() => {
    if (!scan) return 0
    return scan.items
      .filter((item) => selected.has(item.id) && !item.readonly)
      .reduce((sum, item) => sum + item.bytes, 0)
  }, [scan, selected])

  const photoSelectedBytes = useMemo(() => {
    if (!photoScan) return 0
    return photoScan.groups
      .flatMap((g) => g.photos)
      .filter((p) => photoSelected.has(p.id))
      .reduce((sum, p) => sum + p.bytes, 0)
  }, [photoScan, photoSelected])

  const chartData = useMemo(() => {
    if (!scan) return []
    return scan.items.slice(0, 8).map((item) => ({
      name: item.name.length > 11 ? `${item.name.slice(0, 11)}…` : item.name,
      fullName: item.name,
      gb: Math.round((item.bytes / (1024 ** 3)) * 100) / 100,
    }))
  }, [scan])

  async function runSystemScan() {
    setLoading(true)
    setError(null)
    setToast(null)
    setProgress({ phase: 'scan', current: 0, total: 0, label: '准备扫描…' })
    try {
      const result = await fetchScan()
      setScan(result)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  async function runPhotoScan() {
    setLoading(true)
    setError(null)
    setAccessHelp(null)
    setToast(null)
    setProgress({ phase: 'scan', current: 0, total: 0, label: '准备扫描相册…' })
    try {
      const result = await fetchPhotoScan()
      setPhotoScan(result)
      setPhotoSelected(new Set())
      if (result.accessError) setError(result.accessError)
      setAccessHelp(result.accessHelp || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '相册扫描失败')
      setAccessHelp(null)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  function runScan() {
    return mode === 'system' ? runSystemScan() : runPhotoScan()
  }

  function toggle(id: string, readonly: boolean) {
    if (readonly) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePhoto(id: string) {
    setPhotoSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectSafe() {
    if (!scan) return
    setSelected(
      new Set(
        scan.items
          .filter((item) => item.safety === 'safe' && !item.readonly)
          .map((item) => item.id),
      ),
    )
  }

  function selectDuplicatePhotos() {
    if (!photoScan) return
    const next = new Set<string>()
    for (const group of photoScan.groups) {
      for (const photo of group.photos) {
        if (!photo.keepSuggested) next.add(photo.id)
      }
    }
    setPhotoSelected(next)
  }

  function clearSelection() {
    if (mode === 'system') setSelected(new Set())
    else setPhotoSelected(new Set())
  }

  function openGroupViewer(groupId: string) {
    if (!photoScan) return
    const index = photoScan.groups.findIndex((g) => g.id === groupId)
    if (index >= 0) setGroupViewerIndex(index)
  }

  function goViewerGroup(delta: number) {
    if (groupViewerIndex == null || !photoScan) return
    const next = groupViewerIndex + delta
    if (next < 0 || next >= photoScan.groups.length) return
    setGroupViewerIndex(next)
  }

  async function ignoreGroup(groupId: string) {
    if (!photoScan) return
    const groupIndex = photoScan.groups.findIndex((g) => g.id === groupId)
    const group = groupIndex >= 0 ? photoScan.groups[groupIndex] : null
    if (!group) return
    if (!window.confirm(`忽略该相似组（${group.count} 张）？之后扫描将不再显示。`)) return
    try {
      await ignorePhotoGroup({
        key: group.key,
        paths: group.photos.map((p) => p.path),
      })
      const nextGroups = photoScan.groups.filter((g) => g.id !== groupId)
      setPhotoScan({
        ...photoScan,
        groups: nextGroups,
        summary: {
          ...photoScan.summary,
          similarGroupCount: Math.max(0, photoScan.summary.similarGroupCount - 1),
          similarPhotoCount: Math.max(0, photoScan.summary.similarPhotoCount - group.count),
          reclaimableBytes: Math.max(0, photoScan.summary.reclaimableBytes - group.reclaimableBytes),
          ignoredGroupCount: (photoScan.summary.ignoredGroupCount || 0) + 1,
        },
      })
      setPhotoSelected((prev) => {
        const next = new Set(prev)
        for (const photo of group.photos) next.delete(photo.id)
        return next
      })
      if (groupViewerIndex != null) {
        if (nextGroups.length === 0) setGroupViewerIndex(null)
        else setGroupViewerIndex(Math.min(groupIndex, nextGroups.length - 1))
      }
      setToast('已忽略该组，重新扫描后也不会再出现')
    } catch (err) {
      setError(err instanceof Error ? err.message : '忽略失败')
    }
  }

  async function runClean() {
    if (mode === 'photos') {
      await runPhotoClean()
      return
    }
    if (!scan || selectedBytes <= 0) return
    const paths = scan.items
      .filter((item) => selected.has(item.id) && !item.readonly)
      .flatMap((item) => item.paths)

    if (
      !window.confirm(
        `将删除 ${paths.length} 个路径，预计释放约 ${formatBytes(selectedBytes)}。\n此操作不可恢复，确认继续？`,
      )
    ) {
      return
    }

    setCleaning(true)
    setError(null)
    setProgress({ phase: 'clean', current: 0, total: paths.length, label: '准备清理…' })
    try {
      const result = await cleanPaths(paths)
      setToast(
        `已释放 ${formatBytes(result.freedBytes)}` +
          (result.skipped.length || result.errors.length
            ? `（跳过 ${result.skipped.length}，失败 ${result.errors.length}）`
            : ''),
      )
      await runSystemScan()
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败')
    } finally {
      setCleaning(false)
      setProgress(null)
    }
  }

  async function runPhotoClean() {
    if (!photoScan || photoSelectedBytes <= 0) return
    const photos = photoScan.groups.flatMap((g) => g.photos).filter((p) => photoSelected.has(p.id))

    // 避免全屏预览挡住系统权限弹窗
    setGroupViewerIndex(null)
    setCleaning(true)
    setError(null)
    setProgress({ phase: 'clean', current: 0, total: photos.length, label: '准备删除…' })
    try {
      const result = await deletePhotos(
        photos.map((photo) => ({
          path: photo.path,
          uuid: photo.photosUuid || null,
          fileName: photo.fileName,
          bytes: photo.bytes,
        })),
      )
      if (result.deleted.length === 0) {
        setError(
          result.errors[0]?.reason ||
            '删除未成功：未能把照片移入「最近删除」。请确认已允许访问照片图库，并在系统确认框中点「删除」。',
        )
      } else {
        const deletedPaths = new Set(result.deleted.map((item) => item.path))
        const deletedIds = new Set(
          photos.filter((photo) => deletedPaths.has(photo.path)).map((photo) => photo.id),
        )
        const nextGroups = photoScan.groups
          .map((group) => {
            const remaining = group.photos.filter((photo) => !deletedIds.has(photo.id))
            if (remaining.length < 2) return null
            const sorted = [...remaining].sort((a, b) => b.bytes - a.bytes || b.mtime - a.mtime)
            const withKeep = sorted.map((photo, index) => ({
              ...photo,
              keepSuggested: index === 0,
            }))
            return {
              ...group,
              photos: withKeep,
              count: withKeep.length,
              bytes: withKeep.reduce((sum, photo) => sum + photo.bytes, 0),
              reclaimableBytes: withKeep.slice(1).reduce((sum, photo) => sum + photo.bytes, 0),
            }
          })
          .filter((group): group is NonNullable<typeof group> => group != null)

        setPhotoScan({
          ...photoScan,
          groups: nextGroups,
          summary: {
            ...photoScan.summary,
            photoCount: Math.max(0, photoScan.summary.photoCount - deletedIds.size),
            similarGroupCount: nextGroups.length,
            similarPhotoCount: nextGroups.reduce((sum, group) => sum + group.count, 0),
            reclaimableBytes: nextGroups.reduce((sum, group) => sum + group.reclaimableBytes, 0),
          },
        })
        setPhotoSelected((prev) => {
          const next = new Set(prev)
          for (const id of deletedIds) next.delete(id)
          return next
        })
        setToast(
          `已删除 ${result.deleted.length} 张并移入「最近删除」` +
            (result.errors.length ? `，失败 ${result.errors.length} 张` : '') +
            '。请到「照片 → 边栏实用工具 → 最近删除」查看（可能需解锁）。',
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setCleaning(false)
      setProgress(null)
    }
  }

  const progressText = (() => {
    if (!progress) return null
    const { phase, current, total, label } = progress
    const isPostHash =
      label.includes('比对') || label.includes('缩略图') || label.includes('筛选') || label.includes('合并')
    if (total <= 0) return label
    if (phase === 'clean') return `清理 ${current}/${total} · ${label}`
    if (isPostHash) return `${label} ${current}/${total}`
    return `扫描 ${current}/${total} · ${label}`
  })()

  const disk = scan?.disk
  const foundShare = disk ? percent(scan.summary.totalBytes, disk.total) : 0
  const usedShare = disk ? percent(disk.used, disk.total) : 0

  const cleanLabel =
    mode === 'system'
      ? cleaning
        ? '清理中…'
        : `清理所选（${formatBytes(selectedBytes)}）`
      : cleaning
        ? '删除中…'
        : `删除所选（${formatBytes(photoSelectedBytes)}）`

  const cleanDisabled =
    loading ||
    cleaning ||
    (mode === 'system' ? selectedBytes <= 0 : photoSelectedBytes <= 0)

  return (
    <div className="app">
      <div className="drag-bar" aria-hidden />
      <header className="hero">
        <div className="hero-inner">
          <div className="brand">
            <h1>Cleaner</h1>
          </div>

          <div className="mode-tabs" role="tablist" aria-label="扫描模式">
            <button
              type="button"
              role="tab"
              className={`mode-tab ${mode === 'system' ? 'active' : ''}`}
              aria-selected={mode === 'system'}
              onClick={() => setMode('system')}
            >
              系统数据扫描
            </button>
            <button
              type="button"
              role="tab"
              className={`mode-tab ${mode === 'photos' ? 'active' : ''}`}
              aria-selected={mode === 'photos'}
              onClick={() => setMode('photos')}
            >
              相册扫描
            </button>
          </div>

          <div className="actions">
            <button className="btn btn-primary" onClick={runScan} disabled={loading || cleaning}>
              {loading ? '扫描中…' : mode === 'system' ? (scan ? '重新扫描' : '开始扫描') : photoScan ? '重新扫描相册' : '开始扫描相册'}
            </button>
            {mode === 'system' && scan && (
              <button className="btn btn-ghost" onClick={selectSafe} disabled={loading || cleaning}>
                仅选安全项
              </button>
            )}
            {mode === 'photos' && photoScan && (
              <button className="btn btn-ghost" onClick={selectDuplicatePhotos} disabled={loading || cleaning}>
                选中建议删除项
              </button>
            )}
            {((mode === 'system' && scan) || (mode === 'photos' && photoScan)) && (
              <>
                <button className="btn btn-ghost" onClick={clearSelection} disabled={loading || cleaning}>
                  清空选择
                </button>
                <button className="btn btn-danger" onClick={runClean} disabled={cleanDisabled}>
                  {cleanLabel}
                </button>
              </>
            )}
            {mode === 'system' && scan && !loading && <span className="meta">扫描于 {scan.scannedAt}</span>}
            {mode === 'photos' && photoScan && !loading && (
              <span className="meta">扫描于 {photoScan.scannedAt}</span>
            )}
            {progressText && <span className="meta progress-live">{progressText}</span>}
          </div>
        </div>
      </header>

      <main className="content">
        {error && (
          <div className="error">
            <div>{error}</div>
            {accessHelp?.code === 'PHOTOS_DB_PERMISSION' && (
              <div className="error-help">
                <p>
                  开发模式（npm run dev:app）不会出现名为 Cleaner 的项。请把
                  <code>Electron.app</code>
                  加到完全磁盘访问权限，然后完全退出并重开应用。
                </p>
                <div className="error-actions">
                  <button type="button" className="btn btn-ghost btn-compact" onClick={() => openFullDiskAccess()}>
                    打开权限设置
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() =>
                      revealElectronApp().catch((err) =>
                        setError(err instanceof Error ? err.message : '无法定位 Electron.app'),
                      )
                    }
                  >
                    在 Finder 中显示 Electron.app
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {mode === 'system' && !scan && !loading && !error && (
          <div className="empty">点击「开始扫描」，检查系统数据、开发缓存、IDE 残留等常见大户。</div>
        )}

        {mode === 'photos' && !photoScan && !loading && !error && (
          <div className="empty">
            点击「开始扫描相册」，在「照片」图库中查找相似图片并合并展示。删除前会移到废纸篓。
          </div>
        )}

        {loading && (
          <div className="status">
            <div className="spinner" aria-hidden />
            <div>{progressText || '正在后台扫描，窗口可继续操作…'}</div>
          </div>
        )}

        {mode === 'system' && scan && (
          <>
            <section className="stats">
              <div className="stat">
                <div className="label">发现可关注占用</div>
                <div className="value">{formatBytes(scan.summary.totalBytes)}</div>
                <div className="hint">{scan.summary.itemCount} 个检查项</div>
              </div>
              <div className="stat">
                <div className="label">可安全删除</div>
                <div className="value">{formatBytes(scan.summary.safeBytes)}</div>
                <div className="hint">默认已勾选</div>
              </div>
              <div className="stat">
                <div className="label">需确认</div>
                <div className="value">{formatBytes(scan.summary.cautionBytes)}</div>
                <div className="hint">含只读引导项</div>
              </div>
              <div className="stat">
                <div className="label">磁盘剩余</div>
                <div className="value">{formatBytes(scan.disk.free)}</div>
                <div className="hint">共 {formatBytes(scan.disk.total)}</div>
              </div>
            </section>

            <section className="panel-grid">
              <div className="panel">
                <h2>磁盘与发现项占比</h2>
                <div className="disk-bar" aria-label="磁盘使用条">
                  <span className="used" style={{ width: `${Math.max(usedShare - foundShare, 0)}%` }} />
                  <span className="found" style={{ width: `${foundShare}%` }} />
                </div>
                <div className="legend">
                  <span>
                    <i style={{ background: 'var(--chart-2)' }} />
                    其他已用 {formatBytes(Math.max(scan.disk.used - scan.summary.totalBytes, 0))}
                  </span>
                  <span>
                    <i style={{ background: 'var(--chart-3)' }} />
                    本次发现 {formatBytes(scan.summary.totalBytes)}
                  </span>
                  <span>
                    <i style={{ background: '#dfe8e5' }} />
                    剩余 {formatBytes(scan.disk.free)}
                  </span>
                </div>
              </div>

              <div className="panel">
                <h2>占用 Top 项（GB）</h2>
                <div className="top-chart" style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={chartData}
                      layout="vertical"
                      margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }} unit=" GB" />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={132}
                        interval={0}
                        tick={{ fontSize: 12, fill: 'var(--muted)' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        formatter={(value) => [`${value} GB`, '大小']}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                      />
                      <Bar dataKey="gb" radius={[0, 6, 6, 0]}>
                        {chartData.map((_, index) => (
                          <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <div className="toolbar">
              <div className="filters">
                {(
                  [
                    ['all', '全部'],
                    ['safe', '可安全删除'],
                    ['caution', '需确认'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={`chip ${filter === key ? 'active' : ''}`}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="meta">
                已选 {selected.size} 项 · {formatBytes(selectedBytes)}
              </span>
            </div>

            <section className="list">
              {visibleItems.map((item) => {
                const isSelected = selected.has(item.id)
                return (
                  <article
                    key={item.id}
                    className={`item ${isSelected ? 'selected' : ''} ${item.readonly ? 'readonly' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={item.readonly}
                      onChange={() => toggle(item.id, item.readonly)}
                      aria-label={`选择 ${item.name}`}
                    />
                    <div className="item-main">
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                      <div className="item-meta">
                        <span className={`badge ${item.safety === 'safe' ? 'badge-safe' : 'badge-caution'}`}>
                          {safetyLabel(item.safety)}
                        </span>
                        <span className="badge badge-cat">{item.category}</span>
                        {item.readonly && <span className="badge badge-ro">需手动处理</span>}
                      </div>
                      <div className="paths">
                        <details>
                          <summary>查看路径（{item.paths.length}）</summary>
                          <ul>
                            {item.breakdown.map((row) => (
                              <li key={row.path}>
                                <code>{row.path}</code> · {formatBytes(row.bytes)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    </div>
                    <div className="item-size">
                      <div className="bytes">{formatBytes(item.bytes)}</div>
                      <div className="share">
                        占发现项 {percent(item.bytes, scan.summary.totalBytes)}%
                      </div>
                    </div>
                  </article>
                )
              })}
            </section>
          </>
        )}

        {mode === 'photos' && photoScan && !loading && (
          <>
            <section className="stats">
              <div className="stat">
                <div className="label">已分析照片</div>
                <div className="value">{photoScan.summary.photoCount}</div>
                <div className="hint">
                  原图 {photoScan.summary.originalCount ?? 0} · 衍生图{' '}
                  {photoScan.summary.derivativeCount ?? 0}
                  {(photoScan.summary.hashFailedCount || 0) > 0
                    ? ` · ${photoScan.summary.hashFailedCount} 张无法解码`
                    : ''}
                </div>
              </div>
              <div className="stat">
                <div className="label">相似组</div>
                <div className="value">{photoScan.summary.similarGroupCount}</div>
                <div className="hint">
                  {photoScan.summary.similarPhotoCount} 张相关照片
                  {(photoScan.summary.ignoredGroupCount || 0) > 0
                    ? ` · 已忽略 ${photoScan.summary.ignoredGroupCount} 组`
                    : ''}
                </div>
              </div>
              <div className="stat">
                <div className="label">建议可清理</div>
                <div className="value">{formatBytes(photoScan.summary.reclaimableBytes)}</div>
                <div className="hint">默认保留每组最大的一张</div>
              </div>
              <div className="stat">
                <div className="label">已选删除</div>
                <div className="value">{formatBytes(photoSelectedBytes)}</div>
                <div className="hint">{photoSelected.size} 张</div>
              </div>
            </section>

            {photoScan.note && <div className="note">{photoScan.note}</div>}

            {photoScan.groups.length === 0 ? (
              <div className="empty">未发现相似照片组。可在拍多张连拍/截图后重试。</div>
            ) : (
              <section className="photo-groups">
                {photoScan.groups.map((group) => (
                  <article key={group.id} className="photo-group">
                    <div className="photo-group-head">
                      <h3>相似组 · {group.count} 张</h3>
                      <div className="photo-group-actions">
                        <span className="meta">
                          共 {formatBytes(group.bytes)} · 建议可清 {formatBytes(group.reclaimableBytes)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() => ignoreGroup(group.id)}
                          disabled={cleaning}
                        >
                          忽略此组
                        </button>
                      </div>
                    </div>
                    <div className="photo-row">
                      {group.photos.map((photo) => {
                        const checked = photoSelected.has(photo.id)
                        return (
                          <div
                            key={photo.id}
                            className={`photo-card ${checked ? 'selected' : ''} ${photo.keepSuggested ? 'keep' : ''}`}
                          >
                            <label className="photo-check">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePhoto(photo.id)}
                                aria-label={`选择 ${photo.fileName}`}
                              />
                            </label>
                            <button
                              type="button"
                              className="photo-thumb"
                              onClick={() => openGroupViewer(group.id)}
                              title="查看本组大图"
                            >
                              {photo.thumbDataUrl ? (
                                <img src={photo.thumbDataUrl} alt={photo.fileName} />
                              ) : (
                                <div className="photo-fallback">无预览</div>
                              )}
                            </button>
                            <div className="photo-info">
                              <div className="photo-name" title={photo.fileName}>
                                {photo.fileName}
                              </div>
                              <div className="photo-meta">
                                {formatBytes(photo.bytes)}
                                {photo.keepSuggested ? ' · 建议保留' : ''}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </main>

      {viewingGroup && groupViewerIndex != null && photoScan && (
        <div className="group-viewer" role="dialog" aria-modal="true" aria-label="相似组大图">
          <div className="group-viewer-top">
            <div>
              <div className="lightbox-title">
                相似组 {groupViewerIndex + 1}/{photoScan.groups.length} · {viewingGroup.count} 张
              </div>
              <div className="meta">
                共 {formatBytes(viewingGroup.bytes)} · 本组已选删除{' '}
                {viewingGroup.photos.filter((p) => photoSelected.has(p.id)).length} 张 · 左右键切换组别
              </div>
            </div>
            <div className="group-viewer-top-actions">
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => ignoreGroup(viewingGroup.id)}
                disabled={cleaning}
              >
                忽略此组
              </button>
              <button
                type="button"
                className="btn btn-danger btn-compact"
                onClick={runPhotoClean}
                disabled={cleanDisabled}
              >
                {cleanLabel}
              </button>
              <button type="button" className="btn btn-ghost btn-compact" onClick={() => setGroupViewerIndex(null)}>
                关闭
              </button>
            </div>
          </div>

          <div className="group-viewer-body">
            <button
              type="button"
              className="group-nav group-nav-prev"
              onClick={() => goViewerGroup(-1)}
              disabled={groupViewerIndex <= 0}
              aria-label="上一组"
            >
              <span>上一组</span>
              <small>
                {groupViewerIndex > 0
                  ? `${groupViewerIndex}/${photoScan.groups.length}`
                  : '已是第一组'}
              </small>
            </button>

            <div
              className={`group-viewer-grid ${viewerOrientation === 'portrait' ? 'is-portrait' : 'is-landscape'}`}
            >
              {viewingGroup.photos.map((photo) => {
                const checked = photoSelected.has(photo.id)
                const previewState = groupPreviews[photo.id]
                return (
                  <label
                    key={photo.id}
                    className={`group-viewer-card ${checked ? 'selected' : ''} ${photo.keepSuggested ? 'keep' : ''}`}
                  >
                    <div className="group-viewer-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePhoto(photo.id)}
                        aria-label={`选择删除 ${photo.fileName}`}
                      />
                      <span>{checked ? '将删除' : '保留'}</span>
                    </div>
                    <div className="group-viewer-image">
                      {previewState?.dataUrl ? (
                        <img
                          src={previewState.dataUrl}
                          alt={photo.fileName}
                          onLoad={(event) => {
                            const img = event.currentTarget
                            if (!img.naturalWidth || !img.naturalHeight) return
                            setViewerImageSizes((prev) => {
                              const existing = prev[photo.id]
                              if (
                                existing &&
                                existing.w === img.naturalWidth &&
                                existing.h === img.naturalHeight
                              ) {
                                return prev
                              }
                              return {
                                ...prev,
                                [photo.id]: { w: img.naturalWidth, h: img.naturalHeight },
                              }
                            })
                          }}
                        />
                      ) : (
                        <div className="photo-fallback">无法预览</div>
                      )}
                      {previewState?.loading && <div className="group-viewer-loading">加载大图…</div>}
                    </div>
                    <div className="group-viewer-meta">
                      <div className="photo-name" title={photo.fileName}>
                        {photo.fileName}
                      </div>
                      <div className="photo-meta">
                        {formatBytes(photo.bytes)}
                        {photo.keepSuggested ? ' · 建议保留' : ''}
                        {previewState?.error ? ` · ${previewState.error}` : ''}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            <button
              type="button"
              className="group-nav group-nav-next"
              onClick={() => goViewerGroup(1)}
              disabled={groupViewerIndex >= photoScan.groups.length - 1}
              aria-label="下一组"
            >
              <span>下一组</span>
              <small>
                {groupViewerIndex < photoScan.groups.length - 1
                  ? `${groupViewerIndex + 2}/${photoScan.groups.length}`
                  : '已是最后一组'}
              </small>
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>{toast}</span>
          <button
            className="btn btn-ghost"
            style={{ color: '#fff', borderColor: 'rgba(255,255,255,.35)' }}
            onClick={() => setToast(null)}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  )
}

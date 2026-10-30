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
import { cleanPaths, fetchScan, onProgress, type ProgressInfo } from './api'
import { formatBytes, percent } from './format'
import type { ScanItem, ScanResult } from './types'
import './App.css'

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
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressInfo | null>(null)

  useEffect(() => onProgress(setProgress), [])

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

  const chartData = useMemo(() => {
    if (!scan) return []
    return scan.items.slice(0, 8).map((item) => ({
      name: item.name.length > 11 ? `${item.name.slice(0, 11)}…` : item.name,
      fullName: item.name,
      gb: Math.round((item.bytes / (1024 ** 3)) * 100) / 100,
    }))
  }, [scan])

  async function runScan() {
    setLoading(true)
    setError(null)
    setToast(null)
    setProgress({ phase: 'scan', current: 0, total: 0, label: '准备扫描…' })
    try {
      const result = await fetchScan()
      setScan(result)
      setSelected(
        new Set(
          result.items
            .filter((item) => item.selectedByDefault && !item.readonly)
            .map((item) => item.id),
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败')
    } finally {
      setLoading(false)
      setProgress(null)
    }
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

  function clearSelection() {
    setSelected(new Set())
  }

  async function runClean() {
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
      await runScan()
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败')
    } finally {
      setCleaning(false)
      setProgress(null)
    }
  }

  const progressText = progress
    ? progress.total > 0
      ? `${progress.phase === 'scan' ? '扫描' : '清理'} ${progress.current}/${progress.total} · ${progress.label}`
      : progress.label
    : null

  const disk = scan?.disk
  const foundShare = disk ? percent(scan.summary.totalBytes, disk.total) : 0
  const usedShare = disk ? percent(disk.used, disk.total) : 0

  return (
    <div className="app">
      <div className="drag-bar" aria-hidden />
      <header className="hero">
        <div className="hero-inner">
          <div className="brand">
            <h1>Cleaner</h1>
            <span className="tag">macOS 可清理空间检查</span>
          </div>
          <div className="actions">
            <button className="btn btn-primary" onClick={runScan} disabled={loading || cleaning}>
              {loading ? '扫描中…' : scan ? '重新扫描' : '开始扫描'}
            </button>
            {scan && (
              <>
                <button className="btn btn-ghost" onClick={selectSafe} disabled={loading || cleaning}>
                  仅选安全项
                </button>
                <button className="btn btn-ghost" onClick={clearSelection} disabled={loading || cleaning}>
                  清空选择
                </button>
                <button
                  className="btn btn-danger"
                  onClick={runClean}
                  disabled={loading || cleaning || selectedBytes <= 0}
                >
                  {cleaning ? '清理中…' : `清理所选（${formatBytes(selectedBytes)}）`}
                </button>
              </>
            )}
            {scan && !loading && <span className="meta">扫描于 {scan.scannedAt}</span>}
            {progressText && <span className="meta progress-live">{progressText}</span>}
          </div>
        </div>
      </header>

      <main className="content">
      {error && <div className="error">{error}</div>}

      {!scan && !loading && !error && (
        <div className="empty">点击「开始扫描」，检查 Hugging Face、模拟器、JetBrains、npm 等常见大户。</div>
      )}

      {loading && (
        <div className="status">
          <div className="spinner" aria-hidden />
          <div>{progressText || '正在后台扫描，窗口可继续操作…'}</div>
        </div>
      )}

      {scan && (
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
      </main>

      {toast && (
        <div className="toast">
          <span>{toast}</span>
          <button className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.35)' }} onClick={() => setToast(null)}>
            关闭
          </button>
        </div>
      )}
    </div>
  )
}

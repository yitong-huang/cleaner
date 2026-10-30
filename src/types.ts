export type Safety = 'safe' | 'caution' | 'keep'

export interface ScanChild {
  name: string
  bytes: number
}

export interface PathBreakdown {
  path: string
  bytes: number
}

export interface ScanItem {
  id: string
  name: string
  category: string
  safety: Safety
  description: string
  bytes: number
  paths: string[]
  breakdown: PathBreakdown[]
  children: ScanChild[]
  readonly: boolean
  selectedByDefault: boolean
}

export interface ScanResult {
  scannedAt: string
  disk: {
    total: number
    used: number
    free: number
  }
  summary: {
    itemCount: number
    totalBytes: number
    safeBytes: number
    cautionBytes: number
    reclaimableBytes: number
  }
  items: ScanItem[]
}

export interface CleanResult {
  deleted: { path: string; bytes: number; via?: string; uuid?: string }[]
  skipped: { path: string; reason: string }[]
  errors: { path: string; reason: string }[]
  freedBytes: number
  viaPhotosApp?: boolean
}

export interface PhotoItem {
  id: string
  path: string
  fileName: string
  bytes: number
  mtime: number
  photosUuid?: string | null
  source?: 'original' | 'derivative' | 'file'
  thumbDataUrl: string | null
  keepSuggested: boolean
}

export interface PhotoGroup {
  id: string
  key: string
  count: number
  bytes: number
  reclaimableBytes: number
  photos: PhotoItem[]
}

export interface PhotoAccessHelp {
  code: string
  detail?: string | null
}

export interface PhotoScanResult {
  scannedAt: string
  accessError: string | null
  accessHelp?: PhotoAccessHelp | null
  note: string | null
  summary: {
    discoveredCount: number
    photoCount: number
    hashFailedCount: number
    originalCount?: number
    derivativeCount?: number
    groupCount: number
    similarGroupCount: number
    similarPhotoCount: number
    ignoredGroupCount: number
    totalBytes: number
    reclaimableBytes: number
  }
  groups: PhotoGroup[]
}

export type AppMode = 'system' | 'photos'

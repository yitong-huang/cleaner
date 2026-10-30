import type { ProgressInfo } from './api'
import type { CleanResult, PhotoScanResult, ScanResult } from './types'

interface CleanerApi {
  scan: () => Promise<ScanResult>
  clean: (paths: string[]) => Promise<CleanResult>
  scanPhotos: () => Promise<PhotoScanResult>
  deletePhotos: (
    targets: Array<
      | string
      | {
          path: string
          uuid?: string | null
          photosUuid?: string | null
          fileName?: string
          bytes?: number
        }
    >,
  ) => Promise<CleanResult>
  previewPhoto: (filePath: string) => Promise<{ dataUrl: string }>
  ignorePhotoGroup: (payload: { paths: string[]; key?: string }) => Promise<{ key: string }>
  getAccessInfo: () => Promise<{
    isDev: boolean
    appName: string
    electronAppPath: string | null
    execPath: string
  }>
  openFullDiskAccess: () => Promise<{ ok: boolean }>
  revealElectronApp: () => Promise<{ ok: boolean; path: string }>
  onProgress: (callback: (progress: ProgressInfo) => void) => () => void
  platform: string
}

declare global {
  interface Window {
    cleaner: CleanerApi
  }
}

export {}

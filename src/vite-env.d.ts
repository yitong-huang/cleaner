import type { ProgressInfo } from './api'
import type { CleanResult, ScanResult } from './types'

interface CleanerApi {
  scan: () => Promise<ScanResult>
  clean: (paths: string[]) => Promise<CleanResult>
  onProgress: (callback: (progress: ProgressInfo) => void) => () => void
  platform: string
}

declare global {
  interface Window {
    cleaner: CleanerApi
  }
}

export {}

import type { CleanResult, ScanResult } from './types'

export interface ProgressInfo {
  phase: 'scan' | 'clean'
  current: number
  total: number
  label: string
}

function getApi() {
  if (!window.cleaner) {
    throw new Error('请通过 Cleaner 桌面客户端打开，网页模式已停用。')
  }
  return window.cleaner
}

export async function fetchScan(): Promise<ScanResult> {
  return getApi().scan()
}

export async function cleanPaths(paths: string[]): Promise<CleanResult> {
  return getApi().clean(paths)
}

export function onProgress(callback: (progress: ProgressInfo) => void): () => void {
  return getApi().onProgress(callback)
}

import type { CleanResult, PhotoScanResult, ScanResult } from './types'

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

export async function fetchPhotoScan(): Promise<PhotoScanResult> {
  return getApi().scanPhotos()
}

export async function deletePhotos(
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
): Promise<CleanResult> {
  return getApi().deletePhotos(targets)
}

export async function previewPhoto(filePath: string): Promise<{ dataUrl: string }> {
  return getApi().previewPhoto(filePath)
}

export async function ignorePhotoGroup(payload: {
  paths: string[]
  key?: string
}): Promise<{ key: string }> {
  return getApi().ignorePhotoGroup(payload)
}

export async function getAccessInfo() {
  return getApi().getAccessInfo()
}

export async function openFullDiskAccess() {
  return getApi().openFullDiskAccess()
}

export async function revealElectronApp() {
  return getApi().revealElectronApp()
}

export function onProgress(callback: (progress: ProgressInfo) => void): () => void {
  return getApi().onProgress(callback)
}

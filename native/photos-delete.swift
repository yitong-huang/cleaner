import Foundation
import Photos

// 用法：photos-delete <UUID 或 localIdentifier> ...
// 输出单行 JSON：{"status":"ok|denied|cancelled|error","deleted":[...],"missing":[...],"error":"..."}

func emit(_ payload: [String: Any]) -> Never {
  if let data = try? JSONSerialization.data(withJSONObject: payload),
     let text = String(data: data, encoding: .utf8) {
    print(text)
  }
  exit(0)
}

func localIdentifier(_ raw: String) -> String {
  let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.contains("/") { return trimmed }
  return "\(trimmed.uppercased())/L0/001"
}

let inputs = Array(CommandLine.arguments.dropFirst()).filter { !$0.isEmpty }
if inputs.isEmpty {
  emit(["status": "error", "error": "未提供要删除的照片 ID", "deleted": [], "missing": []])
}

let authSemaphore = DispatchSemaphore(value: 0)
var authStatus: PHAuthorizationStatus = .notDetermined
PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
  authStatus = status
  authSemaphore.signal()
}
authSemaphore.wait()

guard authStatus == .authorized || authStatus == .limited else {
  emit([
    "status": "denied",
    "error": "未获得照片图库访问权限（状态 \(authStatus.rawValue)）",
    "deleted": [],
    "missing": inputs,
  ])
}

let idByInput = Dictionary(uniqueKeysWithValues: inputs.map { ($0, localIdentifier($0)) })
let fetch = PHAsset.fetchAssets(withLocalIdentifiers: Array(Set(idByInput.values)), options: nil)
var assets: [PHAsset] = []
var foundIds = Set<String>()
fetch.enumerateObjects { asset, _, _ in
  assets.append(asset)
  foundIds.insert(asset.localIdentifier)
}

let found = inputs.filter { foundIds.contains(idByInput[$0]!) }
let missing = inputs.filter { !foundIds.contains(idByInput[$0]!) }

if assets.isEmpty {
  emit(["status": "error", "error": "在照片图库中找不到这些项目", "deleted": [], "missing": missing])
}

do {
  try PHPhotoLibrary.shared().performChangesAndWait {
    PHAssetChangeRequest.deleteAssets(assets as NSArray)
  }
  emit(["status": "ok", "deleted": found, "missing": missing])
} catch {
  let nsError = error as NSError
  // 用户在系统确认框点了「不允许」
  let cancelled = nsError.domain == "PHPhotosErrorDomain" && nsError.code == 3072
  emit([
    "status": cancelled ? "cancelled" : "error",
    "error": "\(nsError.localizedDescription) (\(nsError.domain) \(nsError.code))",
    "deleted": [],
    "missing": missing,
  ])
}

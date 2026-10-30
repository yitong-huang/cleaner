#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/electron/bin"
mkdir -p "$OUT"

xcrun swiftc -O \
  -target arm64-apple-macos13.0 \
  -framework Photos \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$ROOT/native/Info.plist" \
  "$ROOT/native/photos-delete.swift" \
  -o "$OUT/photos-delete"

codesign --force --sign - --identifier com.cleaner.macos.photos-delete "$OUT/photos-delete"
echo "built $OUT/photos-delete"

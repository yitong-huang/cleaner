#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP="$ROOT/release/mac-arm64/Cleaner.app"
OUT="$ROOT/release/Cleaner-0.1.0-arm64.dmg"
STAGE="$ROOT/release/dmg-stage"

echo "==> 构建前端"
npm run build

echo "==> 打包 Cleaner.app"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir

if [[ ! -d "$APP" ]]; then
  echo "打包失败：找不到 $APP" >&2
  exit 1
fi

echo "==> 生成 DMG"
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Cleaner" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
xattr -cr "$APP" "$OUT" || true
rm -rf "$STAGE"

echo "==> 完成"
ls -lh "$APP" "$OUT"

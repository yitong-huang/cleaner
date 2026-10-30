# Cleaner

macOS 可清理空间检查客户端：扫描 Hugging Face、模拟器、IDE 缓存等常见占用，勾选后清理。

## 环境要求

- macOS（当前打包目标为 Apple Silicon / arm64）
- Node.js 18+
- 首次安装 Electron 二进制如较慢，可使用项目内 `.npmrc` 的国内镜像

```bash
npm install
```

## 开发

```bash
# 启动桌面客户端（Vite + Electron）
npm run dev:app
```

调试主进程时可加：

```bash
CLEANER_DEBUG=1 npm run dev:app
```

## 打包成 macOS 应用

一键打包（等价于执行 `scripts/make-dmg.sh`）：

```bash
npm run build:app
# 或
bash scripts/make-dmg.sh
```

脚本会依次：

1. `npm run build` — 构建前端到 `dist/`
2. `electron-builder --mac --dir` — 生成 `Cleaner.app`
3. `hdiutil` — 生成 DMG

产物：

| 文件 | 说明 |
|------|------|
| `release/mac-arm64/Cleaner.app` | 可直接运行的应用 |
| `release/Cleaner-0.1.0-arm64.dmg` | 安装镜像（可拖到「应用程序」） |

包为**未签名**构建；首次打开若被拦截，在 Finder 中右键 → **打开**。

## 应用图标

- 源图：`build/icon.png`
- macOS 图标：`build/icon.icns`
- 修改图标后需重新执行 `npm run build:app` 才会打进安装包

## 其他命令

```bash
npm run build      # 仅构建前端
npm run lint       # Oxlint
npm start          # 在已有 dist/ 时直接用 Electron 打开
```

#!/bin/bash
# 寻迹定位专用启动器：把 tauri dev 构建的 debug 二进制装进 .app wrapper 再启动。
#
# 为什么需要它：macOS 对裸二进制的定位请求无条件拒绝且不弹授权窗（已实测
# macOS 26：内嵌 plist、双 key、显式 requestAlwaysAuthorization 全部无效）；
# 必须 .app bundle + 描述串才弹窗。tauri dev 直接跑裸二进制 → 定位永远失败。
#
# 用法：先在另一个终端跑 pnpm tauri:dev（vite :5180 必须活着，前端 HMR 会
# 直接进这个窗口），Rust 代码变更后重跑本脚本即可。旧 tauri dev 窗口可最小化。
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"

# 两个可能的 cargo target 目录都认，取最新的二进制
# （历史遗留：~/.zshrc 曾 export CARGO_TARGET_DIR 指向 ~/.cache，优先级高于
#  .cargo/config.toml 的 target-dir；2026-09-09 起统一走 config.toml）
BIN=""
for c in "$HOME/Library/Caches/onethu-cargo-target/debug/onethu" "$HOME/.cache/onethu/cargo-target/debug/onethu"; do
  if [ -f "$c" ] && { [ -z "$BIN" ] || [ "$c" -nt "$BIN" ]; }; then BIN="$c"; fi
done
if [ -z "$BIN" ]; then echo "✗ 未找到 debug 二进制——先跑 pnpm tauri:dev（或 cargo build）"; exit 1; fi
echo "· 二进制：$BIN ($(stat -f '%Sm' "$BIN"))"

APP="$HOME/Library/Caches/onethu/OneTHU.app"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/onethu.new"
mv -f "$APP/Contents/MacOS/onethu.new" "$APP/Contents/MacOS/onethu" # 原子替换，不打扰运行中的实例

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>app.onethu.desktop</string>
	<key>CFBundleName</key>
	<string>OneTHU</string>
	<key>CFBundleDisplayName</key>
	<string>OneTHU</string>
	<key>CFBundleExecutable</key>
	<string>onethu</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>LSMinimumSystemVersion</key>
	<string>11.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSLocationWhenInUseUsageDescription</key>
	<string>用于在寻迹页标注你的位置并计算前往各日程地点的预估时间（拒绝后使用校园中心估算）。</string>
	<key>NSLocationUsageDescription</key>
	<string>用于在寻迹页标注你的位置并计算前往各日程地点的预估时间。</string>
</dict>
</plist>
PLIST

codesign -f -s - "$APP" >/dev/null 2>&1
open "$APP"
echo "✓ 已启动 OneTHU.app（定位可用）。首次会弹定位授权窗，点【允许】。"

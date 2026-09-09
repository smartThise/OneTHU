#!/bin/bash
# OneTHU dev 启动器（v3 灵动岛起：一条命令跑全功能 wrapper）。
#
# 为什么不再直接 `tauri dev`：macOS TCC 对裸二进制无条件拒定位/麦克风且不弹
# 授权窗（macOS 26 实测；语音缺键时甚至直接 SIGABRT 崩——见 2026-09-09 崩溃
# 报告）。.app bundle + 描述串 + ad-hoc 签名才弹窗。所以 dev 一律走 wrapper：
# vite（HMR 直进 wrapper 窗口）+ cargo debug 构建 + dev-app.sh 装壳启动。
#
# Rust 代码变更：重跑本命令即可（重编 + 重开 wrapper）。
# 前端变更：vite 还活着就自动 HMR，无需重跑。
set -euo pipefail
cd "$(dirname "$0")/.." # apps/desktop

# ① vite :5180（没起就后台拉起；prebuild 与 tauri beforeDevCommand 同链）
if ! curl -sf -o /dev/null http://127.0.0.1:5180 --max-time 1; then
  echo "· vite 未运行，后台启动（日志 /tmp/onethu-vite.log）…"
  node ./scripts/prebuild.mjs
  ( nohup pnpm dev >/tmp/onethu-vite.log 2>&1 & )
  ok=""
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null http://127.0.0.1:5180 --max-time 1; then ok=1; break; fi
    sleep 1
  done
  if [ -z "$ok" ]; then echo "✗ vite 30s 未就绪（看 /tmp/onethu-vite.log）"; exit 1; fi
fi
echo "· vite :5180 ✓"

# ② Rust debug 构建（沿用 ._* 清理惯例；target 目录交给 cargo 配置/环境）
(
  cd src-tauri
  find . -name '._*' -delete 2>/dev/null || true
  cargo build
)

# ③ 装壳 + 启动（定位/语音授权窗都会正常弹）
exec bash scripts/dev-app.sh

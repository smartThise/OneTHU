#!/usr/bin/env bash
# OneTHU Android 构建助手 —— 挂载持久 APFS 构建卷 + 全套环境 + pipefail 防吞错
# 用法: bash tools/build-android.sh [--release]
# 产物: apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/*/
set -o pipefail

# 1) 构建卷：未挂载则挂 sparsebundle（系统会悄悄卸载空闲卷——2026-09-08 实录）
if ! [ -d /Volumes/OneTHUBuild ]; then
  echo "[build] /Volumes/OneTHUBuild 未挂载，重新挂载 sparsebundle…"
  hdiutil attach /Volumes/PortableSSD/oh-build.sparse.bundle 2>/dev/null \
    || hdiutil attach /Volumes/PortableSSD/oh-build.sparsebundle || exit 1
fi

export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
export CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-android

cd "$(dirname "$0")/../apps/desktop" || exit 1
find src-tauri -name '._*' -delete 2>/dev/null

MODE="--debug"
[ "${1:-}" = "--release" ] && MODE="--release"
pnpm exec tauri android build --apk --target aarch64 $MODE

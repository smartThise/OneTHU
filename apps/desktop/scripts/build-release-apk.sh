#!/bin/bash
# 正式版 APK 构建器（发布线 dev2/dev3 专用；demo 分支用 build-demo-apk.sh）。
#
# 与 demo 脚本的差别：工程用 ~/onethu-android（正式标识 app.onethu.desktop）、
# 输出名带版本号、**构建前校验发布线不变量**（不脱敏 + 正式身份）——2026-09-21 曾把
# demo 专属提交（脱敏开关/独立应用身份）误合进发布线，这道校验先拦住再谈构建。
#
# 为什么需要这个脚本：Tauri 生成的 Android 工程**不能放在 exFAT 卷**上——
# Gradle 会把它自己写出的 AppleDouble 副档（`._drawable`、`._X.class`）当成真实
# 条目读取/删除，于是报「is not a directory」「Failed to delete some children」。
# 而仓库就在 exFAT 移动盘上，所以工程必须挪到内盘 APFS，再用符号链接挂回来。
#
# 但换位置会踩第二个坑：`app/build.gradle.kts` 里的 `rootDirRel = "../../../"`
# 是**相对工程根**算的（Tauri CLI 生成时按 gen/android 位置推导），经符号链接后
# Gradle 解析出真实路径，`../../../` 落到 /Users，于是 npm 在 /Users 找 package.json
# 直接失败。本脚本把 rootDirRel 改成绝对路径解决。
#
# 第三个坑：Gradle 调 cargo 时 cwd 是 apps/desktop，而指定内盘 target 的
# `.cargo/config.toml` 在 src-tauri/ 下（cargo 只按当前目录往上找配置），
# 于是落回 exFAT 的 src-tauri/target → tauri build.rs 读到 ._default.toml 直接 panic。
# 脚本用 CARGO_TARGET_DIR 环境变量强制覆盖。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
TAURI_DIR="$REPO/apps/desktop/src-tauri"
GEN="$TAURI_DIR/gen/android"
PROJ_PRIMARY="$HOME/onethu-android"
OUT_DIR="${ONETHU_APK_OUT:-$HOME/Desktop/OneTHU-builds}"
CARGO_TARGET="${CARGO_TARGET_DIR:-$HOME/Library/Caches/onethu/cargo-target}"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | tail -1)}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export CARGO_TARGET_DIR="$CARGO_TARGET"
export COPYFILE_DISABLE=1
export PATH="$JAVA_HOME/bin:$PATH"

TC="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin"
export CC_aarch64_linux_android="$TC/aarch64-linux-android24-clang"
export AR_aarch64_linux_android="$TC/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$TC/aarch64-linux-android24-clang"

[ -x "$JAVA_HOME/bin/java" ] || { echo "✗ 找不到 JDK 17（${JAVA_HOME}）"; exit 1; }
[ -d "$NDK_HOME" ] || { echo "✗ 找不到 NDK（${NDK_HOME}）"; exit 1; }

# ① 工程就位：内盘优先；若当前是仓库内的实体目录（首次生成的结果）则搬过去
PREV_LINK=""
if [ -L "$GEN" ]; then PREV_LINK="$(readlink "$GEN")"; fi
if [ ! -d "$PROJ_PRIMARY" ]; then
  if [ -d "$GEN" ] && [ ! -L "$GEN" ]; then
    echo "· 把 gen/android 实体目录搬到内盘：$PROJ_PRIMARY"
    mv "$GEN" "$PROJ_PRIMARY"
  else
    echo "✗ 内盘工程不存在（${PROJ_PRIMARY}）。请先在发布线跑："
    echo "    rm -f $GEN && pnpm --filter @onethu/desktop exec tauri android init --ci"
    echo "  生成后本脚本会自动把它搬到内盘。"
    exit 1
  fi
fi

# ② rootDirRel 改绝对路径 + BuildTask 支持绝对路径（幂等）
GRADLE="$PROJ_PRIMARY/app/build.gradle.kts"
BTASK="$(find "$PROJ_PRIMARY/buildSrc" -name BuildTask.kt | head -1)"
python3 - "$GRADLE" "$BTASK" "$REPO/apps/desktop" <<'PY'
import io, sys
gradle, btask, target = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(gradle, encoding='utf-8').read()
import re
s2 = re.sub(r'rootDirRel = "[^"]*"',
            'rootDirRel = "%s"  // 由 build-demo-apk.sh 改为绝对路径：工程在符号链接后面时相对路径会算错' % target,
            s, count=1)
if s2 != s:
    io.open(gradle, 'w', encoding='utf-8').write(s2)
    print('· rootDirRel → %s（绝对路径）' % target)
# Kotlin 的 File(parent, child) 遇到绝对 child 会拼成相对路径，必须显式判断
t = io.open(btask, encoding='utf-8').read()
needle = 'workingDir(File(project.projectDir, rootDirRel))'
if needle in t:
    t = t.replace(needle,
        '// 绝对路径必须直接用，File(parent, child) 会把绝对 child 当相对路径拼错\n'
        '            workingDir(if (File(rootDirRel).isAbsolute) File(rootDirRel) else File(project.projectDir, rootDirRel))')
    io.open(btask, 'w', encoding='utf-8').write(t)
    print('· BuildTask.kt 支持绝对 rootDirRel')
PY

# ②.5 发布线不变量：脱敏必须关、身份必须是正式包名（构建前拦住，别打出一个脱敏/异包名正式版）
python3 - "$REPO" <<'PY'
import io, json, re, sys
repo = sys.argv[1]
conf = json.load(io.open(repo + '/apps/desktop/src-tauri/tauri.conf.json', encoding='utf-8'))
priv = io.open(repo + '/packages/core/src/privacy/config.ts', encoding='utf-8').read()
bad = []
if conf.get('identifier') != 'app.onethu.desktop':
    bad.append('identifier=%s（应为 app.onethu.desktop）' % conf.get('identifier'))
if conf.get('productName') != 'OneTHU':
    bad.append('productName=%s（应为 OneTHU）' % conf.get('productName'))
if 'export const DESENSITIZE_ENABLED = false;' not in priv:
    bad.append('脱敏开关不是 false（正式版不得脱敏）')
if bad:
    print('✗ 发布线不变量未满足，拒绝构建：')
    for b in bad:
        print('  - ' + b)
    sys.exit(1)
print('· 发布线不变量通过（OneTHU / app.onethu.desktop / 不脱敏）')
PY

# ③ 符号链接指向内盘工程
if [ "$PREV_LINK" != "$PROJ_PRIMARY" ]; then
  ln -sfn "$PROJ_PRIMARY" "$GEN"
  echo "· gen/android → ${PROJ_PRIMARY}（原指向：${PREV_LINK:-无}）"
fi

# ④ 清干净（exFAT 时代残留的 ._ 与旧产物一并处理）
rm -rf "$PROJ_PRIMARY/build" "$PROJ_PRIMARY/buildSrc/build" "$PROJ_PRIMARY/app/build" \
       "$PROJ_PRIMARY/.gradle" "$PROJ_PRIMARY/.kotlin"
find "$PROJ_PRIMARY" -name '._*' -delete 2>/dev/null || true
rm -rf "$TAURI_DIR/target" # 误落在 exFAT 上的 target（若上一次构建踩过坑）

# ⑤ 构建
echo "· 开始构建（JDK $(java -version 2>&1 | head -1 | sed 's/.*"\(.*\)".*/\1/')，NDK $(basename "$NDK_HOME")）"
cd "$REPO/apps/desktop"
LOG="$OUT_DIR/apk-build.log"
if ! npx tauri android build --apk --target aarch64 > "$LOG" 2>&1; then
  echo "✗ 构建失败，错误摘要："
  sed -n '/What went wrong/,/^\* Try:/p' "$LOG" | head -20
  echo "（完整日志：${LOG}）"
  exit 1
fi
echo "· 构建完成（日志：${LOG}）"

# ⑥ 对齐 + 签名
APK="$(find "$PROJ_PRIMARY/app/build/outputs/apk" -name '*release*.apk' ! -name '*unsigned*' ! -name '*aligned*' 2>/dev/null | head -1)"
UNSIGNED="$(find "$PROJ_PRIMARY/app/build/outputs/apk" -name '*unsigned*.apk' 2>/dev/null | head -1)"
SRC="${APK:-$UNSIGNED}"
[ -n "$SRC" ] || { echo "✗ 没找到产物 APK"; exit 1; }
mkdir -p "$OUT_DIR"
STAMP="$(date +%m%d-%H%M)"
VERSION="$(python3 -c "import json,sys;print(json.load(open('$TAURI_DIR/tauri.conf.json'))['version'])" 2>/dev/null || echo 0.0.0)"
OUT="$OUT_DIR/OneTHU-$VERSION-$STAMP.apk"
BT="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | tail -1)"
"$BT/zipalign" -p -f 4 "$SRC" "$OUT"
# 签名：默认用 debug keystore —— 与线上 Release（v0.9.0 资产）同证书（Android Debug），
# 内测同学可直接覆盖升级。若要改用正式 keystore，给 ONETHU_KEYSTORE / ONETHU_KS_PASS /
# ONETHU_KEY_PASS / ONETHU_KEY_ALIAS（注意：换证书后老用户必须卸载重装）。
KS="${ONETHU_KEYSTORE:-$HOME/.android/debug.keystore}"
KS_ALIAS="${ONETHU_KEY_ALIAS:-androiddebugkey}"
KS_PASS="${ONETHU_KS_PASS:-android}"
KEY_PASS="${ONETHU_KEY_PASS:-android}"
"$BT/apksigner" sign --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KEY_PASS" "$OUT"

echo
echo "✓ 产物：$OUT ($(du -h "$OUT" | cut -f1))"
"$BT/aapt2" dump badging "$OUT" 2>/dev/null | head -3 || true
echo "· 安装：adb install -r \"$OUT\""

# ⑦ 复原 gen/android 指向——基准是**入库的**符号链接目标
COMMITTED_LINK="$(git -C "$REPO" cat-file -p HEAD:apps/desktop/src-tauri/gen/android 2>/dev/null || true)"
if [ -n "$COMMITTED_LINK" ] && [ "$COMMITTED_LINK" != "$PROJ_PRIMARY" ]; then
  git -C "$REPO" checkout -- apps/desktop/src-tauri/gen/android
  echo "· gen/android 已复原为入库指向：${COMMITTED_LINK}"
else
  echo "· gen/android 保持指向 ${PROJ_PRIMARY}（入库指向即内盘 demo 工程）"
fi

# ⑧ 反向复核：正式版产物不得含开发者面板（开关泄漏即拦下；dev 包见 scripts/build-dev-apk.sh）
python3 - "$OUT" <<\PY
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
hit = any(b"/assets/DevPanel-" in z.read(n) for n in z.namelist() if n.endswith(".so"))
print("开发者面板: " + ("泄漏进正式包" if hit else "正式包中确认不存在"))
sys.exit(1 if hit else 0)
PY

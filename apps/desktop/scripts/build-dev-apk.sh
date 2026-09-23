#!/usr/bin/env bash
# OneTHU-Dev APK 构建器：与正式版共存的开发者测试包。
#
# 与正式版（scripts/build-release-apk.sh）的差别：
#   applicationId  app.onethu.desktop.dev（可与正式版同时安装，互不覆盖）
#   应用名        OneTHU-Dev
#   图标          正式版品牌标（黑底白字 One/THU）的反色版，一眼区分
#   签名          独立 dev keystore（首次运行自动生成，不入库）
#   前端          ONETHU_DEV=1 → 右上角 commit 徽标 + 开发者面板（日志/诊断/导出）
#
# 用法：pnpm --filter @onethu/desktop android:dev
#
# 环境变量覆盖（默认值全部由仓库根与 $HOME 推导，脚本内不含机器专属路径）：
#   JAVA_HOME                     JDK 17 或更高（缺省时由 PATH 上的 javac 推导）
#   ANDROID_HOME / ANDROID_SDK_ROOT   Android SDK（缺省 $HOME/Android/Sdk）
#   NDK_HOME                      NDK（缺省取 $ANDROID_HOME/ndk 下最后一个）
#   ONETHU_ANDROID_PROJ           Android 工程目录（缺省 $HOME/onethu-android）
#   ONETHU_DEV_KEYSTORE           dev 签名库（缺省 $HOME/.onethu/onethu-android-dev.keystore）
#   ONETHU_DEV_KEYSTORE_PASS      keystore 口令（缺省 onethu-dev）
#   ONETHU_APK_OUT                产物目录（缺省 $HOME/Desktop/OneTHU-builds）
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
DESKTOP="$REPO/apps/desktop"
GEN="$DESKTOP/src-tauri/gen/android"
PROJ="${ONETHU_ANDROID_PROJ:-$HOME/onethu-android}"
KS="${ONETHU_DEV_KEYSTORE:-$HOME/.onethu/onethu-android-dev.keystore}"
KSPASS="${ONETHU_DEV_KEYSTORE_PASS:-onethu-dev}"
KSALIAS="onethu-dev"
OUT_DIR="${ONETHU_APK_OUT:-$HOME/Desktop/OneTHU-builds}"

# ---------- 1. 工具链 ----------
if [ -z "${JAVA_HOME:-}" ]; then
  JAVAC="$(command -v javac || true)"
  [ -n "$JAVAC" ] || { echo "✗ 找不到 javac：请设 JAVA_HOME 指向 JDK 17 或更高"; exit 1; }
  JAVA_HOME="$(cd "$(dirname "$JAVAC")/.." && pwd)"
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
[ -x "$JAVA_HOME/bin/java" ] || { echo "✗ JAVA_HOME 下没有 java：$JAVA_HOME"; exit 1; }

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
[ -d "$ANDROID_HOME" ] || { echo "✗ 找不到 Android SDK：请设 ANDROID_HOME"; exit 1; }

NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | tail -1 || true)}"
export NDK_HOME
if [ -z "${NDK_HOME:-}" ] || [ ! -d "$NDK_HOME" ]; then
  echo "✗ 找不到 NDK：请设 NDK_HOME，或装到 \$ANDROID_HOME/ndk/ 下"
  exit 1
fi
echo "· JDK $JAVA_HOME"
echo "· SDK $ANDROID_HOME"
echo "· NDK $NDK_HOME"

# ---------- 2. 工程就位（Tauri 生成的工程不入库）----------
PREV_LINK=""
if [ -L "$GEN" ]; then PREV_LINK="$(readlink "$GEN")"; fi
restore_gen() {
  if [ -n "$PREV_LINK" ]; then ln -sfn "$PREV_LINK" "$GEN"; else rm -f "$GEN"; fi
}
trap restore_gen EXIT

if [ ! -d "$PROJ" ]; then
  if [ -d "$GEN" ] && [ ! -L "$GEN" ]; then
    echo "· 把仓库内的 Android 工程搬到 $PROJ"
    mv "$GEN" "$PROJ"
  else
    echo "· 首次生成 Android 工程：tauri android init"
    rm -f "$GEN"
    ( cd "$DESKTOP" && pnpm exec tauri android init --ci )
    mv "$GEN" "$PROJ"
  fi
fi
ln -sfn "$PROJ" "$GEN"

# ---------- 3. dev 变体补丁（幂等，含图标同步）----------
python3 "$REPO/tools/patch-android-dev.py" "$PROJ" --repo "$REPO"

# ---------- 4. dev 签名库（各自生成，不入库）----------
if [ ! -f "$KS" ]; then
  echo "· 生成 dev 签名库：$KS"
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -v -keystore "$KS" -alias "$KSALIAS" -keyalg RSA -keysize 2048 -validity 10000 -storepass "$KSPASS" -keypass "$KSPASS" -dname "CN=OneTHU-Dev, OU=OneTHU, O=OneTHU, L=Beijing, ST=Beijing, C=CN" >/dev/null
fi

# ---------- 5. 构建 ----------
TARGETS="$OUT_DIR/.onethu-dev-targets.txt"
mkdir -p "$OUT_DIR"
rustup target list --installed > "$TARGETS" 2>/dev/null || true
grep -q "^aarch64-linux-android$" "$TARGETS" || rustup target add aarch64-linux-android
rm -f "$TARGETS"
cd "$DESKTOP"
export ORG_GRADLE_PROJECT_onethuDev=true
export ONETHU_DEV=1
pnpm exec tauri android build --apk --target aarch64

grep -rq "onethu.dev.badge.hidden" dist/assets || { echo "✗ dev 面板没进前端产物：ONETHU_DEV 未生效"; exit 1; }
echo "· 前端产物含 dev 面板"

# ---------- 6. 对齐 + 签名 ----------
APK="$(find "$GEN/app/build/outputs/apk" -name "*-unsigned.apk" | head -1)"
[ -n "$APK" ] || { echo "✗ 没找到未签名 APK"; exit 1; }
BT="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | tail -1 || true)"
[ -n "$BT" ] || { echo "✗ 找不到 build-tools"; exit 1; }

ALIGNED="$OUT_DIR/.onethu-dev-aligned.apk"
OUT="$OUT_DIR/onethu-dev-arm64.apk"
"$BT/zipalign" -f 4 "$APK" "$ALIGNED"
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KSPASS" --key-pass "pass:$KSPASS" --out "$OUT" "$ALIGNED"
rm -f "$ALIGNED"

# ---------- 7. 校验 ----------
# 不要用管道把 aapt2 接到 grep -q：脚本开了 pipefail，grep 命中即退出会让 aapt2 收到 SIGPIPE
# （退出码 141），整条管道判为失败，正确的包名也会被误报。这里统一落文件再查。
BADGE="$OUT_DIR/.onethu-dev-badging.txt"
"$BT/aapt2" dump badging "$OUT" > "$BADGE" 2>/dev/null || true
if ! grep -q "package: name=.app.onethu.desktop.dev." "$BADGE"; then
  echo "✗ 包名不是 app.onethu.desktop.dev：dev 开关没生效"
  head -2 "$BADGE" || true
  rm -f "$BADGE"
  exit 1
fi
head -1 "$BADGE"
rm -f "$BADGE"
python3 - "$OUT" <<\PY
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
hit = any(b"/assets/DevPanel-" in z.read(n) for n in z.namelist() if n.endswith(".so"))
print("dev 面板: " + ("已进 APK" if hit else "未进 APK"))
sys.exit(0 if hit else 1)
PY
echo "✓ dev APK 完成：$OUT"

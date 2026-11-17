# Android 构建 / 模拟器验证 Runbook（2026-10-18）


> 归档说明：本文记录 2026-10-18 当时的 Android 构建配置与模拟器实测步骤；0.11 当前功能与最新构建说明请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

## 环境

- Android SDK/NDK：`/Volumes/OneTHUBuild/oh-android-sdk`（NDK 27.1.12297006）
- JDK：17（`/usr/libexec/java_home -v 17`）
- AVD：`onethu-demo`（android-35 google_apis arm64-v8a）
- Gradle 工程：`apps/desktop/src-tauri/gen/android`（**软链到 `/Volumes/OneTHUBuild/onethu-android`**；Android 工程与构建缓存统一存放在外置 SSD，以节省内置磁盘空间）

> 提示：`tauri android build` 默认未自动注入 NDK 的 linker 与 CC，直接运行会导致 Rust 调用宿主机 `cc` 链接 Android 目标。构建前请先显式导出以下环境变量（均已在当次环境实测验证）：

```bash
NDK=/Volumes/OneTHUBuild/oh-android-sdk/ndk/27.1.12297006
BIN=$NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin
export PATH=$BIN:$PATH NDK_HOME=$NDK
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$BIN/aarch64-linux-android34-clang
export CC_aarch64_linux_android=$BIN/aarch64-linux-android34-clang
export CXX_aarch64_linux_android=$BIN/aarch64-linux-android34-clang++
export AR_aarch64_linux_android=$BIN/llvm-ar
```

## 只编译 Kotlin（快速排查原生层语法错误）

```bash
cd apps/desktop/src-tauri/gen/android
JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew \
  :tauri-plugin-onethu-mobile:compileDebugKotlin :app:compileArmDebugKotlin --offline
```

## 打 debug APK

```bash
cd apps/desktop
# 先导出上面的 NDK 环境变量
pnpm tauri android build --debug
# 产物：src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## 模拟器安装/启动

```bash
EMU=/Volumes/OneTHUBuild/oh-android-sdk/emulator/emulator
ADB=/Volumes/OneTHUBuild/oh-android-sdk/platform-tools/adb
$EMU -avd onethu-demo -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot &
$ADB wait-for-device
$ADB install -r apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
$ADB shell am start -W -n app.onethu.desktop/.MainActivity
$ADB exec-out screencap -p > /tmp/onethu-emulator.png
```

## 2026-10-18 实测结果

- Kotlin 编译：插件与主工程均 `BUILD SUCCESSFUL`。
- debug APK 打包：`BUILD SUCCESSFUL`，产出 universal APK（277MB）。
- 模拟器安装与启动：APK 安装顺利，`MainActivity` 冷启动正常进入登录页（截图见 `docs/assets/android-emulator-login-2026-10-18.png`）。
- 返回键行为：在登录页按下系统返回键可正常退出应用进程回到桌面，全程无 `FATAL EXCEPTION`。
- 待真机补测项：由于模拟器无 NFC 硬件且当次未登录真实账号，ReaderMode/HCE 近场交互以及暂存箱、云端界面留待真机登录环境进一步验证。

## 内盘空间纪律（2026-10-18 教训）

- 此前 Tauri/Gradle 构建目录曾放在内置磁盘 `/Users/st/onethu-android`，叠加模拟器 AVD 镜像后占用了大量内盘空间；现已清理并改由软链指向 `/Volumes/OneTHUBuild/onethu-android`。
- 每次构建前请确认 `apps/desktop/src-tauri/gen/android` 软链指向外置 SSD，并将模拟器 AVD 镜像一并存放在外置盘。
- 日常开发请将 Android 与 Gradle 工程目录统一建在外置盘，避免占用 `~/` 主目录空间。

## 已知限制

- `tauri android build` 暂需手动导出上方的 NDK 环境变量，后续可封装为脚本一键调用。
- 生成的 `gen/schemas/*-schema.json` 会随权限或命令变更自动更新，改动后请一并纳入提交。

## 电脑上预览手机端

- 开发模式入口：`http://127.0.0.1:5180/?phone-frame=1`
- 可选参数：`device=15pro|15pm|se|pixel8|mini`、`land=1`、`fit=0`、`scene=page-vault|namecard|settings|page-cloud|...`
- 示例：
  - 暂存箱：`/?phone-frame=1&scene=page-vault`
  - 名片/组织：`/?phone-frame=1&scene=namecard`
- 说明：桌面预览沿用宿主屏幕的 DPR，暂未模拟手机安全区；免登录预览场景首次打开若弹出引导浮层，点击「不再提示」即可关闭。

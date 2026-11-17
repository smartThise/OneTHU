# 开发者构建（dev 版独立构建）

> 最后更新：2026-11-18 01:30

开发者构建基于同一份仓库源码生成第二套独立的可安装产物：桌面端 `onethu-dev.exe` 与 Android 端 `OneTHU-Dev` APK。两套产物共用同一代码库，通过构建开关 `ONETHU_DEV=1` 控制变体：开发者版会打包完整的面板与日志诊断工具，同时在 Android 端采用独立的应用包名、反色图标与专属签名，方便与正式版同机并存安装。

## 1. 产物差异

| 项 | 正式版 | 开发者版 |
|---|---|---|
| 前端开关 | 不设 `ONETHU_DEV` | `ONETHU_DEV=1` |
| 右上角 | 无 | `dev · <commit>` 徽标，工作区有未提交改动时带 `-dirty` |
| 开发者面板 | 未打包 | commit / 构建时间 / 宿主 / 视口 / 前端日志 / 导出与复制 |
| 前端日志 | 仅输出至 webview 控制台 | 同步写入 Rust 日志链 `onethu-debug.log`，支持真机导出 |
| 设置页「运行日志」行 | 隐藏 | 显示 |
| Android 包名 | `app.onethu.desktop` | `app.onethu.desktop.dev` |
| Android 应用名 | OneTHU | OneTHU-Dev |
| Android 图标 | 品牌标（黑底白字 One/THU） | 反色（白底黑字） |
| Android 签名 | 发布 keystore | 独立 dev keystore，首次构建自动生成 |

## 2. 构建

桌面端：

```bash
pnpm --filter @onethu/desktop build:dev          # 只出前端 dist
pnpm --filter @onethu/desktop tauri:build:dev    # 连 tauri 打包
```

Android 端（产出可与正式版并存的 APK）：

```bash
pnpm --filter @onethu/desktop android:dev
```

上述构建入口均在脚本内部设置 `ONETHU_DEV=1`，在 macOS、Linux 以及 Windows 的 `cmd` 和 PowerShell 环境下均可直接运行。Android 构建脚本同时支持通过环境变量自定义工具链与输出目录；未指定时默认基于仓库根目录与 `$HOME` 自动推导，脚本内保持通用相对逻辑：

```bash
JAVA_HOME=... ANDROID_HOME=... NDK_HOME=... \
ONETHU_ANDROID_PROJ=... ONETHU_DEV_KEYSTORE=... ONETHU_APK_OUT=... \
pnpm --filter @onethu/desktop android:dev
```

| 变量 | 默认值 |
|---|---|
| `JAVA_HOME` | 由 PATH 上的 `javac` 推导（需 JDK 17 或更高） |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | `$HOME/Android/Sdk` |
| `NDK_HOME` | `$ANDROID_HOME/ndk` 下最后一个 |
| `ONETHU_ANDROID_PROJ` | `$HOME/onethu-android` |
| `ONETHU_DEV_KEYSTORE` | `$HOME/.onethu/onethu-android-dev.keystore` |
| `ONETHU_DEV_KEYSTORE_PASS` | `onethu-dev` |
| `ONETHU_APK_OUT` | `$HOME/Desktop/OneTHU-builds` |

## 3. 实现方式

构建期常量：`apps/desktop/vite.config.ts` 通过 Vite 的 `define` 注入 `__ONETHU_DEV__`、`__ONETHU_COMMIT__` 与 `__ONETHU_BUILD_TIME__`。其中 commit 取自 `git rev-parse --short HEAD`，工作区有未提交改动时自动追加 `-dirty`，脱离 `.git` 环境时记为 `unknown`。

正式版静态剔除：在正式版构建中，`__ONETHU_DEV__` 常量会折叠为 `false`，Rollup 打包阶段随之静态移除 `Layout.tsx` 中的 `const DevPanel = __ONETHU_DEV__ ? lazy(...) : null` 与 `main.tsx` 中的条件动态 `import`，使开发者面板与日志桥代码仅存在于开发者版产物中。

Android 变体配置：`tools/patch-android-dev.py` 幂等更新 `app/build.gradle.kts` 与 `AndroidManifest.xml`（`devBuild` 读取 `-PonethuDev` 或 `ORG_GRADLE_PROJECT_onethuDev`），并从 `apps/desktop/src-tauri/icons/icon.png` 同步各密度品牌图标、生成白底黑字的反色 dev 图标。常规构建时，`applicationId`、应用名称、图标与版本名保持正式版标准配置。

正式版与开发者版共用 `tools/android-icons.py` 同步原版 Logo（包含常规、圆形及 Android 8+ 自适应图标资源，需要 `PATH` 中安装有 FFmpeg）。正式版构建在完成 APK 签名后，还会调用 SDK 的 `aapt2` 直接核验最终 APK 包内各密度图标像素与 `AndroidManifest.xml` 及自适应图标引用，一旦检测到默认的占位图标即阻断发布，从最终安装包层面确保品牌图标完整生效。

工程目录组织：Tauri 生成的 `src-tauri/gen/android` 保持在版本库之外。`build-dev-apk.sh` 通过 `ONETHU_ANDROID_PROJ` 指向仓库外的工程目录并建立符号链接，脚本退出时自动恢复原状；首次运行若外部工程尚未创建，脚本会先执行 `tauri android init --ci` 初始化工程再迁出仓库。

日志桥机制：`apps/desktop/src/lib/devlog.ts` 采用有界环形缓冲（上限 300 条、单行超过 400 字符截断、每 1.2 秒批量刷盘、单次最多 20 行、连续 3 次失败自动熔断），经既有 Rust 命令 `log_debug` 落盘写入日志文件，并自动过滤自身与 `log_debug` 相关日志以防循环回灌。

## 4. 守卫

```bash
node tools/devtools-test.mjs
```

测试断言覆盖 dev 分支的按需加载方式、日志桥的有界性、正式版构建入口的开关隔离，以及 dev 相关脚本的路径通用性。构建脚本同时在产物层面执行复核：确认开发者包内包含 `/assets/DevPanel-` 分块，且正式版产物保持干净无残留。

## 5. 正式版产物纯净度复核

```bash
pnpm --filter @onethu/desktop build
grep -rl "onethu.dev.badge.hidden" apps/desktop/dist/assets || echo "正式版产物无 dev 面板"
```

## 6. 已知限制

- `ONETHU_DEV=1` 控制前端模块裁剪与 Android 应用标识；底层 Rust 命令 `log_debug`、`debug_log_export` 在两种构建中共用同一编译单元，正式版在设置页隐藏对应入口。
- `dev keystore` 仅保存在本机。更换开发机器或清理该签名文件后，需先卸载手机上旧的 `OneTHU-Dev` 再安装新包。
- 正式版与开发者版前端构建共用 `apps/desktop/dist` 目录，交替执行两种构建时，目录内容对应最近一次执行的构建结果。

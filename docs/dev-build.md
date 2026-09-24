# 开发者构建（dev 版独立构建）

> 最后更新：2026-09-23 19:50

开发者构建指同一份源码产出的第二套可安装产物：桌面端 `onethu-dev.exe`、Android 端
`OneTHU-Dev` APK。两套产物共用源码，差别来自构建开关 `ONETHU_DEV=1`：正式版里不出现的
调试能力在开发者版进包；Android 端的应用标识、图标与签名也与正式版分开，两者可同时安装。

## 1. 产物差异

| 项 | 正式版 | 开发者版 |
|---|---|---|
| 前端开关 | 不设 `ONETHU_DEV` | `ONETHU_DEV=1` |
| 右上角 | 无 | `dev · <commit>` 徽标，工作区有未提交改动时带 `-dirty` |
| 开发者面板 | 不进包 | commit / 构建时间 / 宿主 / 视口 / 前端日志 / 导出与复制 |
| 前端日志 | 只进 webview 控制台 | 同时写入 Rust 日志链 `onethu-debug.log`，真机可导出 |
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

Android 端（产出与正式版共存的 APK）：

```bash
pnpm --filter @onethu/desktop android:dev
```

两条入口都先置 `ONETHU_DEV=1`，因此不依赖 shell 的前缀赋值语法（Windows 的 cmd 与
PowerShell 不支持该写法）。Android 脚本另有环境变量覆盖，默认值全部由仓库根与 `$HOME`
推导，脚本内不含机器专属路径：

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

构建期常量：`apps/desktop/vite.config.ts` 用 Vite 的 `define` 注入 `__ONETHU_DEV__`、
`__ONETHU_COMMIT__`、`__ONETHU_BUILD_TIME__`。commit 取自 `git rev-parse --short HEAD`，
工作区有未提交改动时追加 `-dirty`，仓库无 `.git` 时取 `unknown`。

正式版剔除：`__ONETHU_DEV__` 在正式构建里折叠为 `false`，因此
`Layout.tsx` 的 `const DevPanel = __ONETHU_DEV__ ? lazy(...) : null` 与 `main.tsx` 的
条件动态 `import` 被 rollup 静态删除，开发者面板与日志桥整块不进产物。

Android 变体：`tools/patch-android-dev.py` 幂等改写 `app/build.gradle.kts` 与
`AndroidManifest.xml`（`devBuild` 读 `-PonethuDev` 或 `ORG_GRADLE_PROJECT_onethuDev`），
并从 `apps/desktop/src-tauri/icons/icon.png` 同步各密度图标，另生成反色 dev 图标。不传
开关时 `applicationId`、应用名、图标与版本名与改动前一致。

工程位置：Tauri 生成的 `src-tauri/gen/android` 不入库。`build-dev-apk.sh` 用
`ONETHU_ANDROID_PROJ` 指向仓库外的工程目录并建立符号链接，脚本退出时恢复原链接；工程
不存在时先执行 `tauri android init --ci` 生成再移出仓库。

日志桥：`apps/desktop/src/lib/devlog.ts` 采用有界环形缓冲（300 条上限、单行 400 字符截断、
1.2 秒批量、单次最多 20 行、连续 3 次失败熔断），经既有 Rust 命令 `log_debug` 写入日志文件；
自身行与 `log_debug` 相关行不回灌，避免递归。

## 4. 守卫

```bash
node tools/devtools-test.mjs
```

断言覆盖：dev 分支的加载方式、日志桥的有界性、正式版构建入口不设开关、以及 dev 相关文件
不含机器专属路径。构建脚本另在产物层面复核：开发者包必须含 `/assets/DevPanel-`，正式版
包必须不含。

## 5. 正式版不含 dev 能力的复核

```bash
pnpm --filter @onethu/desktop build
grep -rl "onethu.dev.badge.hidden" apps/desktop/dist/assets || echo "正式版产物无 dev 面板"
```

## 6. 已知限制

- `ONETHU_DEV=1` 影响前端与 Android 应用标识；Rust 命令 `log_debug`、`debug_log_export` 为
  两种构建共有，正式版设置页的入口隐藏但命令仍在。
- dev keystore 不入库。更换机器或删除该文件后，已安装的 dev 包需先卸载再安装新包。
- 正式版与开发者版共用 `apps/desktop/dist`，两种构建交替执行时以最后一次为准。

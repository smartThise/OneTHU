# 安卓 release 构建陷阱与真机取证

> 最后更新：2026-11-18 01:30

本文复盘 2026-09-21 真机排查（在线服务无法打开、PDF 预览失效、小组件不刷新、校内启动变慢）总结出的关键判据与常见陷阱。核心经验如下：

> **桌面端表现正常后，仍必须在安卓 release 真机包上逐项完成验收。** 主窗口固定桌面端 UA、release 包启用 R8 代码混淆、安卓系统缺少 `/tmp` 目录——这三项环境差异都可能让桌面端顺畅运行的代码路径在真机上静默失效。

---

## 1. 插件参数类必须标注 @InvokeArg（避免 R8 下 `parseArgs` 反序列化失败）

**症状**：点击「在线服务」毫无响应（修复后按设计回落至系统浏览器）。

**真因**：`OpenWebModalArgs` 与 `SeedCookiesArgs` 漏写了 `@InvokeArg`。Tauri 依赖该注解生成 Jackson 构造器并指示 R8 保留类结构；漏标注解后，开启混淆的 release 包（`isMinifyEnabled=true`）在调用 `invoke.parseArgs(XxxArgs::class.java)` 时会报错：

```
Cannot construct instance of `u0.l` (no Creators, like default constructor, exist)
```

报错中的 `u0.l` 即混淆后的 Args 参数类。由于 **debug 包默认关闭 R8**，且桌面端不存在这条 Kotlin 调用链，日常开发调试与桌面端测试都难以提前暴露这一问题。

**开发规范**：

- 新增插件命令时，参数类一律标注 `@InvokeArg`；字段采用带默认值的 `var`（避免使用 `lateinit`），确保无参构造器可用，并将字段校验放在业务调用处。
- `plugins/onethu-mobile/android/consumer-rules.pro` 已配置整包保留规则 `-keep class app.onethu.mobile.** { *; }` 作为兜底。
- **修改插件命令后，务必打 release 包在真机上完成验证。**

## 2. 构建产物核验：以构建配置为准，避免用端点字符串判断

在 0.7.2 的一次安卓事故中，手动执行 `cargo build` 时漏加了 `--features tauri/custom-protocol`，导致应用启动后 WebView 直连 `devUrl`。当时曾尝试用 `strings | grep 5180` 检查产物，但开发版与正式版二进制均包含该字符串，无法据此区分构建方式。

区分产物的可靠依据是构建配置与运行期标志本身。宿主已在 `lib.rs` 的 `setup` 入口处加入守卫：当检测到 `tauri::is_dev()` 为真且 dev server 连接失败时，立即弹出原生对话框提示「这是开发版构建，请安装正式版」并退出（此前曾有 Windows 用户误装开发包，启动后直接遇到 `127.0.0.1:5180` 拒绝连接）。

## 3. 安卓判定：主窗口固定桌面端 UA，前端统一走多信号检测

由于校内 webvpn 会话票绑定了 UA 指纹，`tauri.conf.json` 将主窗口 UA 固定为 Windows Chrome/79 且需长期保持不变。受此影响，**真机主窗口中 `/android/i.test(navigator.userAgent)` 始终返回 false**。

- 前端识别安卓环境时，统一使用 `src/lib/androidHost.ts` 提供的多信号判定（综合 UA、`userAgentData.platform` 以及匹配 `navigator.platform ≈ /^Linux (armv\d|aarch)/` 的平台特征）。
- 曾受单一 UA 检测影响的功能包括：PDF 预览（导致 pdf.js 分支未执行）、语音命令路由、寻迹导航深链、卡务「调起支付宝」按钮、外部链 `intent://` 通道，以及插件宿主 `os_is_android` 兜底逻辑。
- 防护校验：`tools/pdf-render-mode-test.mjs` 会扫描整个 `src` 目录，拦截直接依赖裸 UA 判定安卓环境的写法。

## 4. 真机取证：在应用内提供可导出的日志文件

安卓系统没有 `/tmp` 目录，`log_debug` 与 `println!`（含 HTTP 逐跳诊断）早期仅写入 logcat。遇到不便使用 adb 的用户设备时，报错现场无法直接提取——此前「在线服务无法打开」连续两轮未能定位，症结正在于此。

当前日志与取证机制：

| 项 | 位置/用法 |
|---|---|
| 日志落点 | 安卓 `app_data_dir/logs/onethu-debug.log`（16MB 轮转）；桌面 `/tmp/onethu-debug.log` |
| Rust 侧写入 | `debug_log_line(line)`（`LOG_APP: OnceLock<AppHandle>` 在 setup 注入） |
| 用户导出 | 设置 → 关于 → **导出日志**（安卓经 `saveDownload` 桥转存系统「下载」） |
| 失败可见 | 应用内打开失败等原因直接进 toast，`showToast(text, 9000)` 提供充足阅读时间 |
| 计时埋点 | 启动链 `LR-STAGE … +Nms`、HTTP 逐跳 `[NATIVE-HOP{k}] {status} {N}ms {url}`、`[NET-RESOLVE] host → addrs` |

排查方法：**优先补齐用户可导出的日志与清晰的错误 toast，拿到真机现场记录后再着手修复**，减少依赖口头现象描述的猜测。

## 5. 构建环境陷阱（exFAT 外置盘）

- 在 exFAT 外置盘的 `res/` 目录下新建文件会伴生 AppleDouble 隐藏文件（`._*.xml`），AAPT 会将其当作正式资源解析；构建前需运行 `find <res> -name '._*' -delete` 清理。
- **XML 注释中禁止出现连续连字符 `--`**。此前 `drawable-night/onethu_widget_bg.xml` 的注释中含有 `--surface`，直接触发 `parseDebugLocalResources` 抛出 `ResourceDirectoryParseException`，而异常信息未提及注释位置，排查成本极高。
- 在 exFAT 卷上使用部分 write 工具新建文件会返回 ENOTSUP，改用 `cat > f << 'EOF'` 写入即可正常落盘。
- **Android 原生工程需置于内置 APFS 磁盘上**：若直接放在 exFAT 卷上，Gradle 会把自身写出的 AppleDouble 副档（如 `._drawable`、`._X.class`）当作正常目录或类文件读取和删除，进而报 `is not a directory` 或 `Failed to delete some children`。稳妥做法是将生成目录放在内置盘（APFS），再通过符号链接挂回 `src-tauri/gen/android`。
- 改用符号链接后需同步处理路径解析：`app/build.gradle.kts` 中的 `rootDirRel = "../../../"` 由 Tauri CLI 按工程相对位置推导，Gradle 解析符号链接真实路径后该相对路径会落到 `/Users`，导致 npm 在该目录下找不到 `package.json`；将其改为绝对路径即可解决。
- 此外还需显式指定 Cargo 编译目标目录：Gradle 调用 cargo 时工作目录位于 `apps/desktop`，而指向内置盘 target 的 `.cargo/config.toml` 位于 `src-tauri/` 下（cargo 仅按当前目录逐级向上查找配置），结果编译产物默认落回 exFAT 卷的 `src-tauri/target`，致使 Tauri 的 `build.rs` 读到 `._default.toml` 后直接 panic。通过 `CARGO_TARGET_DIR` 环境变量强制覆盖目标路径即可规避。

上述三项处理已固化在打包脚本 `apps/desktop/scripts/build-release-apk.sh`（发布线）与 `build-demo-apk.sh`（demo 线）中：
- 插件构建中间产物位于 `/tmp/onethu-android-plugin-build`（构建异常时可先清理该目录）；
- Rust 构建需设置 `CARGO_TARGET_DIR=/Users/st/Library/Caches/onethu/cargo-target`。

## 6. 小组件（RemoteViews）与网络

- 小组件采用「JS 计算、原生绘制」方案：小组件所在的原生进程不加载 WebView 也不持有会话，仅负责将已有快照数据重绘上屏。渲染口径以 `src/state/widgetNativeRender.ts` 为准，Kotlin 侧 `OnethuWidget.kt` 与之逐条对齐；修改展示逻辑时须先更新 JS 实现并运行 `tools/widget-native-render-test.mjs`。
- 深色模式依托资源限定符 `values-night/` 与 `drawable-night/` 自动跟随系统（启动器重新 inflate 布局时自动命中），富文本 Span 颜色按当前 `uiMode` 动态选取，无需增设独立配置开关。
- 校内网络环境下，单个经 webvpn 包装的请求实测耗时 4–6.4 秒（外网环境约几百毫秒），冷启动耗时主要来自漫游认证链路与多路并行抓取的叠加；排查时可重点查看 `[NATIVE-HOP]` 与 `[NET-RESOLVE]` 两类日志。

## 7. OEM 系统差异

- **灵动岛胶囊文字溢出（小米 HyperOS）**：胶囊宽度原先采用 JS 测量得到的固定宽度（`--island-w` = `getBoundingClientRect().width` + 58），而内部文字 span 在 flex 容器中默认允许收缩且不换行；在字宽较大的系统字体（如 MiSans）下，预测量值跟不上实际排版宽度，导致文字撑出胶囊边界（其他设备表现正常）。现已改为内容自适应宽度（`width: auto` + `flex: none`），配合 `max-width: min(72vw, 460px)` 对超长文本做省略号截断，并由 `tools/island-layout-test.mjs` 持续守护。
- **小组件放置（ColorOS）**：部分启动器的小组件选择器与配置流程衔接存在差异，曾出现绑定完成后桌面未生成卡片的现象。现统一改用系统请求式放置接口（`requestPinAppWidget`）；当启动器返回不支持（`supported=false`）时，界面会引导手动添加，并将系统已登记的 provider 数量回传给界面用于自检。

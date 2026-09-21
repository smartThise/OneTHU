# 安卓 release 构建陷阱与真机取证

本文汇总 2026-09-21 一轮真机问题（在线服务无法打开、PDF 预览失效、小组件不刷新、
校内启动变慢）排查得出的**判据与陷阱**。由此得出的结论是：

> **桌面端表现正常，不代表真机行为正确。** 主窗口 UA 被伪装、release 包启用 R8、
> 安卓没有 `/tmp`，这三点均可单独导致某条代码路径在真机上静默失效。

---

## 1. 插件参数类必须 @InvokeArg（R8 下 `parseArgs` 必然失败）

**症状**：点击「在线服务」无任何响应（后按设计回落系统浏览器）。

**真因**：`OpenWebModalArgs` / `SeedCookiesArgs` 漏写 `@InvokeArg`。tauri 依赖该注解生成
Jackson 构造器并让 R8 保留类结构；漏注解后 release 包（`isMinifyEnabled=true`）里
`invoke.parseArgs(XxxArgs::class.java)` 报：

```
Cannot construct instance of `u0.l` (no Creators, like default constructor, exist)
```

`u0.l` 即被混淆的 Args 类。**debug 包不启用 R8，因此开发期无法发现**；
桌面端也不存在该 Kotlin 调用链，因此桌面测试同样无法发现。

**纪律**：

- 新增插件命令，参数类一律 `@InvokeArg`；字段不使用 `lateinit`（用带默认值的 `var`），
  保证无参构造器存在，校验放在使用处。
- `plugins/onethu-mobile/android/consumer-rules.pro` 已有整包兜底
  `-keep class app.onethu.mobile.** { *; }`。
- **修改插件命令后必须在 release 包上完成真机验证。**

## 2. 判据纪律：端点字符串不能用于判断构建方式

0.7.2 安卓事故：手动 `cargo build` 缺少 `--features tauri/custom-protocol`，
WebView 直连 `devUrl`。当时的判据 `strings | grep 5180` **两种构建都命中**，属于无效判据。

正确判据只有构建方式本身。宿主已在 `lib.rs` 的 `setup` 首部添加守卫：
`tauri::is_dev()` 且 dev server 连接失败 → 弹出原生对话框说明「这是开发版构建，请安装正式版」
后退出（用户实录：Windows 用户获取 dev 包后，打开即出现 `127.0.0.1:5180` 拒绝连接）。

## 3. 安卓判定：主窗口 UA 为伪装值

`tauri.conf.json` 主窗口将 UA 固定为 Windows Chrome/79（webvpn 会话票绑定 UA 指纹，
不可修改）。于是**真机上 `/android/i.test(navigator.userAgent)` 恒为 false**。

- 安卓判定统一采用 `src/lib/androidHost.ts` 的多信号（UA + `userAgentData.platform` +
  `navigator.platform ≈ /^Linux (armv\d|aarch)/`）。
- 受影响功能：PDF 预览（pdf.js 分支从未执行）、语音命令路由、寻迹导航深链、
  卡务「调起支付宝」按钮、外部链 `intent://` 通道、插件宿主 `os_is_android` 兜底。
- 防护措施：`tools/pdf-render-mode-test.mjs` 会扫描整个 `src`，禁止再次出现裸 UA 判定安卓。

## 4. 真机取证：安卓日志需可导出

安卓没有 `/tmp`，`log_debug` 此前仅写入 logcat；`println!`（含 HTTP 逐跳诊断）同理。
用户无法使用 adb 时，失败原因不可见；这正是「在线服务无法打开」问题反复两轮未能定位的原因。

现状：

| 项 | 位置/用法 |
|---|---|
| 日志落点 | 安卓 `app_data_dir/logs/onethu-debug.log`（16MB 轮转）；桌面 `/tmp/onethu-debug.log` |
| Rust 侧写入 | `debug_log_line(line)`（`LOG_APP: OnceLock<AppHandle>` 在 setup 注入） |
| 用户导出 | 设置 → 关于 → **导出日志**（安卓经 `saveDownload` 桥转存系统「下载」） |
| 失败可见 | 应用内打开失败等原因直接进 toast，`showToast(text, 9000)` 提供充足阅读时间 |
| 计时埋点 | 启动链 `LR-STAGE … +Nms`、HTTP 逐跳 `[NATIVE-HOP{k}] {status} {N}ms {url}`、`[NET-RESOLVE] host → addrs` |

排查方法学：**先提供用户可导出的日志与可读的 toast，再进行修复**，不应要求用户描述现象。

## 5. 构建环境陷阱（exFAT 外置盘）

- `res/` 下新建文件会生成 AppleDouble（`._*.xml`），AAPT 会将其当作资源解析 →
  构建前 `find <res> -name '._*' -delete`。
- **XML 注释中不允许出现连续连字符 `--`**。`drawable-night/onethu_widget_bg.xml` 的注释中包含
  `--surface`，直接导致 `parseDebugLocalResources` 报 `ResourceDirectoryParseException`，
  报错信息完全未提及注释，排查成本极高。
- 使用 write 工具新建文件会返回 ENOTSUP，需使用 `cat > f << 'EOF'` 落盘。
- **Android 工程不能放在 exFAT 卷上**：Gradle 会把自己写出的 AppleDouble 副档
  （`._drawable`、`._X.class`）当作真实条目读取与删除，报 `is not a directory` 或
  `Failed to delete some children`。工程须置于内盘（APFS），再以符号链接挂回
  `src-tauri/gen/android`。
- 改用符号链接后出现第二个问题：`app/build.gradle.kts` 的 `rootDirRel = "../../../"`
  由 Tauri CLI 按工程位置推导，Gradle 解析出真实路径后该相对路径落到 `/Users`，npm 在
  该目录找不到 `package.json`；解法是改为绝对路径。
- 第三个问题：Gradle 调 cargo 时工作目录为 `apps/desktop`，而指定内盘 target 的
  `.cargo/config.toml` 位于 `src-tauri/`（cargo 只按当前目录逐级向上查找），于是落回
  exFAT 的 `src-tauri/target`，tauri 的 `build.rs` 读到 `._default.toml` 直接 panic；
  解法是用 `CARGO_TARGET_DIR` 环境变量强制覆盖。

上述三步已固化在打包脚本里：`apps/desktop/scripts/build-release-apk.sh`（发布线）与
`build-demo-apk.sh`（demo 线）。
- 插件构建中间产物在 `/tmp/onethu-android-plugin-build`（异常时先删）；
  Rust 构建需 `CARGO_TARGET_DIR=/Users/st/Library/Caches/onethu/cargo-target`。

## 6. 小组件（RemoteViews）与网络

- 小组件采用「JS 计算、原生绘制」：原生进程无 WebView/无会话，只能重绘已有数据。
  语义锚是 `src/state/widgetNativeRender.ts`，Kotlin `OnethuWidget.kt` 逐条对齐，
  修改语义时须先修改 JS 并运行 `tools/widget-native-render-test.mjs`。
- 深色模式跟随依赖资源限定符 `values-night/` + `drawable-night/`（启动器重新 inflate 时自动命中），
  Span 颜色按 `uiMode` 选取，**不新增设置项**。
- 网络：校内每个 webvpn 包装请求实测 4–6.4 秒（外网几百毫秒），冷启动耗时主要是
  漫游链 + 并行抓取的叠加；排查时查看 `[NATIVE-HOP]` 与 `[NET-RESOLVE]` 两行日志。

## 7. OEM 系统差异

- **灵动岛胶囊文字溢出（小米 HyperOS）**：胶囊宽度原为 JS 测量得到的定宽
  （`--island-w` = `getBoundingClientRect().width` + 58），而文字 span 在 flex 容器中
  默认可收缩且不换行；字体度量一变宽（MiSans 等），测量值跟不上实际渲染宽度，文字于是溢出
  胶囊而不是把胶囊撑长（其他设备正常）。改为内容自适应（`width: auto` + `flex: none`），
  并以 `max-width: min(72vw, 460px)` 对超长文本作省略号收尾。护栏
  `tools/island-layout-test.mjs`。
- **小组件放置（ColorOS）**：部分启动器的选择器与配置流程行为不一致，出现「绑定完成后桌面
  没有卡片」。改用系统请求式放置（`requestPinAppWidget`）；启动器不支持时
  （`supported=false`）界面引导手动添加，并把系统登记的 provider 数回报给界面用于自检。

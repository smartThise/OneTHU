# 原生边界安全审查 · 2026-10-20


> 归档说明：本文记录当时的代码审查与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

本轮集中排查并加固了桌面与移动端共用的原生 `invoke` 命令面，涵盖插件包安装与进程启动、记忆文件镜像、原生 HTTP 重定向以及敏感调试日志出口。测试全程依托本机回环 HTTP 服务与隔离临时目录运行，未读取真实用户凭据、未访问学校接口，也未执行版本发布。客户端整包升级机制的专项复核详见 `2026-10-20-updater-audit.md`（生产环境继续沿用整包升级模式）。

## 已修复漏洞与加固落点

| 缺陷与影响 | 修复落点 |
| --- | --- |
| `plugin_dir` 原先仅校验字符集而放行了 `.` 与 `..`，传入 `..` 调用卸载可能越界删除上级目录；ZIP 包内的 `manifest.entry/bin` 亦缺少边界约束，存在读取包外文件或篡改包外可执行权限的风险。 | `native_security.rs:5` 严格校验插件 ID，`:23` 规范化跨平台相对路径，`:41` 逐级拦截目录链上的符号链接；`lib.rs` 中的导入、图标读取、卸载及内置 sidecar 全部接入同一套路径约束。 |
| 插件 ZIP 导入早先直接覆盖原安装目录后再校验入口，一旦遇到非法路径或缺失入口，旧版已安装插件便已遭破坏。 | `plugin_package.rs:73` 改为先在独立临时目录内完成路径、体积、manifest、重名文件与入口校验（上限 4096 个条目、解压总计 `1 GiB`、清单 `1 MiB`、JS 入口 `32 MiB`），全部通过后再原子切换目录，替换异常时自动回滚恢复旧目录。 |
| `plugin_spawn` 原可传入任意系统路径拉起进程；插件 `storage` 的 ID 未做路径隔离，且遇到损坏 JSON 或磁盘写入失败时仍向前端返回空数据或成功状态。 | `native_security.rs:64` 将可执行文件严格限定在对应插件安装目录内并拦截符号链接与跨插件越界；`plugins.rs:197` 明确区分文件不存在、JSON 损坏与 I/O 失败并返回标准 JSON-RPC error，写入时经唯一临时文件落盘后替换；同时修复进程代际管理，防止旧进程延迟退出误摘除新拉起的替代进程。 |
| 记忆文件镜像早先仅做字面量 `..` 检查，攻击者可借助目录内预先存在的符号链接或固定名称 `.tmp` 链接跳出镜像根目录。 | `memory_mirror.rs` 在逐级路径遍历时拒绝一切符号链接，改用 `create_new` 创建唯一临时文件并在目录枚举时自动跳过链接，同时继续兼容云盘路径常见的起始 `/` 相对根写法。 |
| `http_native` 在每次 HTTP 跳转时都会无条件重放原始 `Authorization`、自定义 token 请求头与非空请求体，且超出跳转上限时静默返回空响应。 | `native_security.rs:187` 改为按完整 `origin`（含端口）判定：同源跳转保持原请求头，跨源跳转仅保留通用内容协商头，同时拦截跨源自动重发非空请求体及 `HTTPS → HTTP` 降级跳转（常规 `302 POST` / `303` 转为 `GET` 的登录跳转继续顺畅通行，Cookie 仍由目标域 Cookie 仓按域匹配）；`lib.rs:1390` 对超限重定向明确报错并施加单跳超时控制。 |
| 原生调试日志早先直接落盘完整 Cookie、`POST` 请求头与请求体、网络学堂响应及场馆预约 JSON，且桌面端直接写在公共可读的 `/tmp/onethu-debug.log`。 | 移除全量报文 dump，逐跳日志仅记录剥离 `query`、`fragment`、`userinfo` 后的纯净 URL、状态码、请求方法与耗时；全平台日志统一迁入应用私有数据目录 `logs/` 下并在 Unix 系统收紧权限为 `0600`。二次复核时一并清理了 `CLOUD-SHELL` 的网页 HTML 全文落盘，令 `debug_log_line` 在写入日志文件及 Android `logcat` 前统一经过 `redact_log` 过滤（剥离 URL 敏感段，识别到 Cookie/Authorization/token/password/API key 等标记后即截断后续内容，转义控制字符并限制单行长度）。 |
| Cookie 持久化与回种流程原先丢失了 `Secure` 属性，旧版 TSV 格式未能准确区分 `host-only` Cookie，按域名清理时重建其余条目还会刷丢原有属性。 | `lib.rs:1283` 改为在同一存储路径完整序列化 `cookie_store` 的 JSON 属性结构（向下兼容读取旧版 TSV 并补回 `Secure` 标记）；按域清理时直接就地移除匹配项，完整保留其余 Cookie 的原始属性，同时延续会话级 Cookie 跨重启保留的既有产品体验。 |
| Windows 端打开本地文件或外部链接早先拼接 `cmd /C start` 命令串，特殊文件名或参数存在被 `cmd` 二次解析的风险。 | `lib.rs:633` 改为直接调用 Tauri 官方 `opener` Rust API：打开本地文件前校验其为真实存在的绝对路径，打开网页链接前校验为不含 `userinfo` 的合规 `HTTP(S)` 地址；锁定的底层依赖 `open 5.4.2` 在 Windows 下通过环境变量传递目标值，彻底消除命令字符串拼接。 |
| 本地状态文件与原生 Cookie 此前采用系统默认宽松权限与固定临时文件名写入。 | `native_security.rs:77` 统一改为 `create_new` 唯一临时文件写入、`flush/sync` 落盘后再 `rename` 原子替换；Unix 权限收紧至 `0600`，并在读取旧版状态文件及旧版 Cookie 时自动迁移收紧文件权限，写入中途若出错则完整保留原文件。 |

注：场馆代理内联 token 脚本的 HTML/JS 转义加固由并行的 HTML 安全专项同步合入，已包含在本轮最终原生编译产物中；配套的 `tools/venue-token-script-browser-test.mjs`（双浏览器引擎 35 项断言）在对应报告中单独计列。

## 自动化验证

以下三条离线测试命令全部以退出码 0 通过，合计覆盖 **20 组 Rust 原生安全单测**：

```sh
CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop/cargo-target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib security --offline
CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop/cargo-target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugin_package::tests --offline
CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop/cargo-target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib memory_mirror::tests --offline
```

- **核心安全与网络（11 组）**：覆盖敏感日志字段、URL 参数与控制字符脱敏；基于本机双端口真实 HTTP 服务验证跨源 `302` 自动剥离鉴权头与请求体、同源 `307` 正常保持、跨源 `307` 带请求体直接拦截（目标端收到 0 次请求）以及 26 跳上限报错；同时验证相对路径越界拦截、插件可执行文件范围约束、`0600` 权限与写失败保旧、Cookie 属性无损往返及损坏 `storage` 错误透传。
- **插件 ZIP 包安全（4 组）**：覆盖合规插件首次导入与覆盖升级、恶意插件 ID / 越界 manifest / Zip-Slip 路径穿越拦截、缺失可执行文件或歧义 JS 入口拒绝、包内符号链接拦截，每组异常用例均确认原有已安装插件完好无损。
- **记忆镜像隔离（5 组）**：覆盖正常读写/列举/删除/统计，以及目录符号链接跳出与固定临时文件名抢占拦截。
- **多目标编译与格式检查**：macOS 原生测试目标编译通过；Android `aarch64-linux-android` 目标离线执行 `cargo check --lib` 在 6.58 秒内以退出码 0 通过（Android 真机打包安装留待发版流水线验证）；定向 `git diff --check` 通过。

末轮统一日志出口兜底回归记录于 `/tmp/onethu-native-security-sink.log`（11 组合成凭据样本全部通过，未读取本机真实日志）；其余完整测试日志保存在 `/tmp/onethu-native-security-final.log`、`/tmp/onethu-plugin-package-security.log`、`/tmp/onethu-memory-mirror-security.log` 与 `/tmp/onethu-native-security-android.log`。

## 当前防护范围与后续演进边界

- **原生插件运行权限模型**：第三方原生插件依然是由用户主动安装并授权运行的本机子进程，天然继承当前系统登录用户的权限；本轮加固重点封堵了 IPC 参数导致的路径越界与误启动，完整的操作系统级进程沙箱与插件数字签名机制留待后续版本演进。
- **并发文件系统竞态与异常恢复**：逐级路径检查能够有效阻断静态符号链接穿越，但同机同用户权限下的极端并发目录替换（TOCTOU）超出应用层防御边界；此外插件升级在两次 `rename` 切换目录的极短窗口内若遭遇系统断电或强杀，磁盘上会保留 `.previous` 备份目录供后续恢复。
- **本地凭据存储与跨平台权限**：Unix `0600` 文件权限主要防范本机其他系统账号越权读取，当前会话、记住密码及插件状态中的凭据仍以本地文件形态存放，后续可进一步接入系统 Keychain / Credential Manager 加密存储；Windows 端目前继承用户应用数据目录的默认 ACL，实机权限细节待 Windows 环境复核。
- **日志脱敏与存量文件清理**：`redact_log` 已为带有标准凭据关键字和 URL 参数的日志提供统一出口兜底，各业务调用方仍应自觉避免输出无格式标记的原始秘密或报文正文；用户设备 `/tmp` 下若存有旧版本遗留的调试日志，程序不会在后台静默删除，交由用户知情清理；同时由于 URL `path` 仍保留用于接口排障，涉及路径内嵌分享令牌的调用方应避免直接打印完整 URL。
- **重定向策略兼容性**：本轮利用本地模拟服务完整验证了校园 SSO 常见的 `302/303` 及同源重定向流程；线上真实校园网登录留待联调阶段确认，若有外部服务依赖跨源 `307/308` 携带请求体跳转，现需由调用方捕获后显式重新发起请求。
- **通用文件与媒体接口**：`read_file_text`、本地媒体文件预览及外部浏览器调试等命令属于支撑用户主动选文件与插件生态的常规宿主能力，本轮已完成静态梳理，更深入的全量原生接口模糊测试可在后续安全周期持续开展。

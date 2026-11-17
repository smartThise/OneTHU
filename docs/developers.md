# 开发者中心


中文 · [English](en/developers.md)

日常开发与版本发布使用 `main` / `dev3` 分支。开始前建议阅读 [架构](architecture.md)、[插件指南](plugin-development.md)、[生成 API 清单](api-surface.md) 与 [OH / 清小搭](oh-and-xiaoda.md)。项目致谢与可复现的 Git 历史统计见 [贡献者与主要贡献者](contributors.md)。

## 本地运行

本地环境需安装 Node.js 20+ 以及 `pnpm`；运行桌面原生宿主还需配置 Rust stable 工具链与对应操作系统的 Tauri 2 系统依赖；构建 Android 安装包则需额外准备 JDK、Android SDK 与 NDK（构建脚本会自动读取环境变量或默认安装路径）。

```bash
git clone --recurse-submodules https://github.com/smartThise/OneTHU.git
cd OneTHU
git switch dev3
git submodule update --init --recursive
pnpm install
pnpm dev
```

`pnpm dev` 会启动轻量级的 Vite 前端开发服务器，基于脱敏模拟数据快速调试界面布局与交互；当需要联调原生网络请求、本地文件读写、系统凭据或技能 IPC 时，请通过下方的 Tauri 桌面或 Android 原生入口启动完整宿主。

```bash
# 桌面 Tauri 开发；Windows 可使用跨平台原始入口
pnpm --filter @onethu/desktop tauri:raw
# 前端开发构建 / 桌面原生开发包
pnpm --filter @onethu/desktop build:dev
pnpm --filter @onethu/desktop tauri:build:dev
# Android 开发包：脚本需要 Bash（Windows 可使用合适的 Bash 环境）
pnpm --filter @onethu/desktop android:dev
```

各平台系统依赖请参照 [Tauri 官方先决条件](https://v2.tauri.app/start/prerequisites/) 安装。构建变体、签名机制与目录约定详见 [开发构建](dev-build.md)；Android 打包注意事项汇总于 [release 陷阱](android-release-traps.md)。本地使用的签名证书、Token 与密码请妥善保存在版本库之外。

## 工程与扩展入口

| 位置 | 职责 |
|---|---|
| `apps/desktop` | React 应用、Tauri 宿主、桌面与 Android 入口 |
| `packages/core` | 校园服务客户端与统一业务模型 |
| `packages/info-lib` | 学校登录、漫游与 2FA hooks |
| `packages/sdk` | 独立 Node 运行时、操作、授权、任务与适配器 |
| `packages/cli` | CLI、MCP、本机 daemon 与导出 |
| `packages/gui` | OneGUI 组件、语义令牌、主题、材质和动效 |
| `apps/desktop/src/plugins/types.ts` | 插件 API 类型真源 |
| `apps/desktop/src/plugins/facade.ts` | 宿主 API 与权限门面 |
| `plugins/OneTHU-Harness` | 独立 Rust Agent 子模块 |
| `tools` | 构建、提取、测试、模拟数据采集 |

普通应用插件、OH 工具、外部 MCP 服务与清小搭技能按各自定位运行在不同的执行环境中：内置 QuickJS 沙箱用于执行纯同步的轻量 JavaScript 代码（配额上限为 2 秒时长、32 MiB 内存、256 KiB 调用栈、64 KiB 代码及输入输出，与网络、文件、进程、模块加载和异步运行时隔离）；依赖复杂本地环境的重型技能可导出为文件夹或 ZIP 压缩包，交由桌面外部 Agent 独立配置与运行；Rust 扩展在桌面端以 sidecar 子进程形式接入，如需覆盖 Android 端则需按移动端原生插件桥单独编译集成。

## 验证与贡献

```bash
pnpm typecheck
pnpm i18n:check
pnpm test:onboarding
node tools/docs-api-surface.mjs
python3 tools/contributors-report.py
pnpm lint:docs
```

提交前请按本次变更涉及的范围运行对应守卫脚本，使测试保持聚焦实用。提取多语言词条后可运行 `pnpm i18n:handoff`，翻译更新仅修改当前交接批次指定的文件。涉及界面改动时，在编译通过后还需进入真实浏览器与目标真机环境，逐一核验横竖屏布局、滚动到底部、点击反馈、键盘操作及「减少动态效果」模式。

公开文档与宣传截图统一通过 [模拟采集流程](screenshots.md) 生成，确保截图、日志与测试夹具全程使用脱敏模拟数据，将真实账号密码、个人学籍资料、Token 与登录二维码严格隔离在外。

访问 [官网开发者页](https://onethu.github.io/developers.html) 即可一站式查阅构建说明、插件开发、Harness、API 文档、OneGUI 与贡献者名录。开源许可附带非商业使用及保护清华大学信息服务安全的相关条款，具体内容以 [LICENSE](../LICENSE) 原文为准。

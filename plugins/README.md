# plugins/ — OneTHU 插件源码目录

本目录存放所有 OneTHU 插件的源码，每个子目录对应一个独立插件。

## 目录结构

| 子目录 | 插件 | 形态 | 内置 |
|---|---|---|---|
| `OneTHU-Harness/` | OneTHU Harness（对话助手内核） | Rust sidecar（Cargo workspace） | ✅ 桌面/Android 均内置 |

## 桌面端运行时目录

- **插件根目录**：统一位于 `appData/plugins/<pluginId>/`（macOS 为 `~/Library/Application Support/<app>/plugins/`，Windows 为 `%APPDATA%/<app>/plugins/`）。
- **外部导入的 Rust 插件**：导入时将 `manifest.json` 与二进制文件一并复制到 `plugins/<id>/` 下，注册表 `binPath` 直接指向该目录，脱离原始下载目录独立运行。
- **内置 OneTHU Harness（OH）**：sidecar 随应用资源打包在 `resources/plugins/onethu.harness/` 中，启动时自动同步到同一插件目录并注册为 `builtin`（在管理页中常驻保留）。

## 插件包结构

无论 Rust 插件还是 JS 插件，导入后均完整存放在运行时插件目录 `appData/plugins/<id>/` 下：

```
my-plugin/
├── manifest.json     # rust 声明 bin；js 可声明 entry
├── <bin 或 entry.js> # rust 二进制 / js 入口模块
└── logo.svg          # 可选：随包 logo（白底方图，viewBox 建议 64×64）
```

- **导入方式**：支持选择 `.zip` 压缩包（推荐）或直接选择文件夹内的 `manifest.json`，宿主会将整个插件包复制进插件目录。
- **随包图标**：在包内放置 `logo.svg`（或 `.png`）即可由宿主自动读取并转为 dataURL 展示；未提供图标时默认回退为双字母徽标。
- **OH 图标**：位于 `plugins/OneTHU-Harness/logo.svg`（白底黑字 `(OH)`，采用代码风括号搭配衬线 O 与黑体 H，与 OneTHU 主品牌字体同族混排），执行 `build:harness` 时一并打包进应用资源。
- **卸载清理**：卸载插件时会同步移除注册表记录并清空对应的插件目录。

## 构建与本地开发

```bash
# 构建 OH sidecar 并放入桌面资源目录（打包前置步骤）
pnpm --filter @onethu/desktop build:harness

# 桌面开发
pnpm --filter @onethu/desktop tauri:dev
```

早期开发阶段使用的 `~/onethu-harness-dist/` 手动部署方式已停用；应用启动时会自动从内置资源目录安装到插件目录，并将旧记录一次性迁移过来。

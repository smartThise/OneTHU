# plugins/ — OneTHU 插件目录（仓库源）

本目录是**一切 OneTHU 插件的源码根**，每个子目录即一个插件。

## 布局契约

| 子目录 | 插件 | 形态 | 内置 |
|---|---|---|---|
| `OneTHU-Harness/` | OneTHU Harness（对话助手内核） | Rust sidecar（Cargo workspace） | ✅ 桌面/Android 均内置 |

## 运行时布局（桌面端）

- 唯一插件根：`appData/plugins/<pluginId>/`（macOS `~/Library/Application Support/<app>/plugins/`，Windows `%APPDATA%/<app>/plugins/`）
- 导入的 rust 插件：manifest.json + 二进制复制进 `plugins/<id>/`，注册表 binPath 指向该处（不再引用用户下载目录）
- 内置 OH：sidecar 随 App 资源打包（`resources/plugins/onethu.harness/`），开机复制到同一插件目录并注册为 `builtin`（管理页不可卸载）

## 插件包形态（导入即整包落位）

一切插件（rust/js）最终都住进运行时插件根 `appData/plugins/<id>/`：

```
my-plugin/
├── manifest.json     # rust 声明 bin；js 可声明 entry
├── <bin 或 entry.js> # rust 二进制 / js 入口模块
└── logo.svg          # 可选：随包 logo（白底方图，viewBox 建议 64×64）
```

- 导入方式：选 `.zip`（优先）或选文件夹内 manifest.json，整包复制进插件目录
- **logo 随包走**：包内放 `logo.svg`（或 .png）即生效，由宿主读取转 dataURL；无 logo 回退双字母针脚
- OH 的 logo：`plugins/OneTHU-Harness/logo.svg`（白底黑字 `(OH)`——代码风括号 + 衬线 O + 黑体 H，与 OneTHU 主品牌同族混排），随 build:harness 一并打包进资源
- 卸载插件 = 删除注册表记录 + 清空其插件目录

## 构建 / 发布

```bash
# 构建 OH sidecar 并放入桌面资源目录（打包前置步骤）
pnpm --filter @onethu/desktop build:harness

# 桌面开发
pnpm --filter @onethu/desktop tauri:dev
```

历史开发用的 `~/onethu-harness-dist/` 手动部署已废弃：开机自动从资源目录
安装到插件目录，并对旧记录做一次性迁移。

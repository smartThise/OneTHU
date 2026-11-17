> 最后更新：2026-11-18 01:30

<div align="center">

<img src="docs/logo-banner.png" alt="One above THU — One THUer should have OneTHU" width="640">

**0.11.4-fix-3 · Revolution**

[中文](README.md) · [English](README.en.md)

校园万物，汇于一处。

[官网](https://onethu.github.io/) · [下载](https://github.com/smartThise/OneTHU/releases/latest) · [文档](https://onethu.github.io/docs/) · [开发者](https://onethu.github.io/developers.html)

</div>

OneTHU 是一款面向清华师生的非官方校园应用，支持 macOS、Windows 与 Android。0.11 版本采用 OneGUI 统一视觉与交互，支持自由定制主题、壁纸与布局，并提供**极简、实用、完整**三种使用模式：全局搜索与 OH 胶囊贯穿三种模式；完整模式进一步开放自由白板、暂存分享、名片与组织、插件、OneTHU Harness 与清小搭。

## OneTHU 与浏览器扩展

| 项目 | 适用场景 | 获取方式 |
|---|---|---|
| [OneTHU](https://github.com/smartThise/OneTHU) | macOS、Windows、Android 校园客户端，整合课程学习、日程提醒、生活预约与常用外部平台。 | [下载应用](https://github.com/smartThise/OneTHU/releases/latest) |
| [NextTHUxk](https://github.com/smartThise/NextTHUxk) | 在教务选课网页直接提供课程检索、课表预览、暂存方案与 AI 辅助排课。 | [安装选课扩展](https://github.com/smartThise/NextTHUxk/releases/latest) |
| [NextTHULearn](https://github.com/smartThise/NextTHULearn) | 打开网络学堂网页即可启用 OneTHU 风格的清爽学习工作台。 | [安装学堂扩展](https://github.com/smartThise/NextTHULearn/releases/latest) |

三个项目均可独立使用；两款浏览器扩展直接复用对应学校网页的登录会话，装上就能用。

## 近期更新

| 版本 | 主要改进 |
|---|---|
| [0.11.4-fix-3 · 当前版本](docs/release-0.11.4-fix-3.md) | 修复保留数据升级后的登录衔接与云盘更新请求参数，保障本机认证与二次验证顺畅。 |
| [0.11.4-fix-1](docs/release-0.11.4-fix-1.md) | 优化 Windows 登录与后台启动体验，修复首页课程展示、平板设置页滚动与手机卡片高度。 |
| [0.11.4](docs/release-0.11.4.md) | 推出独立 CLI、SDK 与桌面常驻后台；OH 接入雨课堂、好友、组织、清小搭与暂存箱，完善附件命名与多账号隔离。 |

## 界面预览（模拟数据）

以下截图全部截取自真实运行的应用界面，填充了离线模拟数据，涵盖手机竖屏、横屏与桌面大屏视图（示例语言为中文）。素材生成方式与校验记录见 [截图来源说明](docs/screenshots.md)。

<table><tr><th>极简</th><th>实用</th><th>完整</th></tr><tr><td><img src="docs/assets/0.11/home-simple.png" alt="极简模式模拟首页" width="250"></td><td><img src="docs/assets/0.11/home-practical.png" alt="实用模式模拟首页" width="250"></td><td><img src="docs/assets/0.11/home-full.png" alt="完整模式模拟首页" width="250"></td></tr></table>

![手机横屏模拟首页](docs/assets/0.11/home-landscape.png)

<details><summary>展开查看桌面大屏、网络学堂、日程与清小搭</summary>

![完整模式桌面](docs/assets/0.11/home-desktop.png)

<table><tr><td><img src="docs/assets/0.11/learn.png" width="250" alt="Learning platform, fictional data"></td><td><img src="docs/assets/0.11/schedule.png" width="250" alt="Schedule, fictional data"></td><td><img src="docs/assets/0.11/xiaoda.png" width="250" alt="Xiaoda, fictional data"></td></tr></table>

</details>

## 0.11 功能一览

| 功能模块 | 体验说明 |
|---|---|
| 三种模式 | **极简**聚焦今日待办与课程；**实用**收纳高频校园服务；**完整**展开可自由编排的工作台。随时切换模式，原有配置与数据都会完好保留。 |
| 统一搜索 | 通过顶部或底部的 OH 胶囊快速检索功能、校园服务与已同步内容，本地直达目标页面，响应迅速。 |
| OneShot / OneGO / 白板 | 默认底栏提供学习、预约、生活、信息、课表五大直达入口；完整模式支持多标签页、OneGO 收藏栏、多工作区与自由白板组件。 |
| 学习与日程 | 汇总网络学堂课程、作业、公告与课件，支持按需接入雨课堂与 OJ 作业；课表、作业截止与个人日程同屏呈现，三种模式均可查看待交截止提醒。 |
| 生活与预约 | 集成校园卡（含余额预警线与恢复后自动撤回提醒）、电费、校园网、清华新闻、空教室、图书馆座位与研讨间查询等常用服务。 |
| 暂存箱与口令 | 长按已接入的卡片或条目，提起即可拖入高亮的暂存箱按钮，并通过在线短口令快捷分享（近期推荐使用短口令，体验比 NFC 更稳定）。 |
| 名片与组织 | 完整模式提供个人名片、好友联络、组织成员权限、共享文件、项目协作与公告管理；数据同步机制详见文档。 |
| OH / OneTHU Harness | 完整模式可调用已授权的应用工具与插件；精简模式支持自填模型 API 及连接微信、飞书通道，模型配置与校园账号相互独立。 |
| 清小搭与技能 | 浏览模型、智能体与技能广场：纯同步 JavaScript 技能可在内置轻量 QuickJS 沙箱中即点即用；需要 Python、Node 或本地命令行环境的技能可一键导出给电脑端 Agent 运行。 |
| 插件生态 | 支持 JS 扩展、桌面 Rust sidecar 与 Android 内嵌插件三种形态；当前开放 41 个命名空间、297 个 API 入口，按声明权限与所在平台运行。 |

## 长按、提起、收纳

下方动图录制自真实交互过程（仅叠加触控指针以便观看）。支持长按拖入的来源涵盖已接入的作业、课件、白板组件、标签页、工作区、搜索结果、日程、名片、邮件与云盘文件。

<img src="docs/assets/0.11/vault-drag.gif" width="300" alt="模拟作业长按拖入暂存箱的完整过程">

[了解暂存范围与组织同步](docs/sharing-and-organizations.md)

## 下载与快速上手

前往 [GitHub Releases](https://github.com/smartThise/OneTHU/releases/latest) 或 [清华云盘镜像](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/) 下载对应系统的安装包（版本发版后云盘镜像会陆续同步）。

1. **选择语言与模式**：首次打开可跟随交互导览熟悉布局，点击导览中的体验入口可直达真实页面并随时返回。
2. **登录校园账号**：使用清华统一认证登录并按提示完成二次验证；邮箱、日历、云盘与大模型等功能可在需要时单独连接授权。
3. **开启提醒与排障**：按需打开作业、日程或余额通知；若遇到网络或登录异常，可先查看应用内的脱敏诊断信息定位原因，稍候再试。

[快速上手指南](docs/getting-started.md) · [隐私与排障说明](docs/privacy-and-troubleshooting.md) · [0.11 版本详情](docs/release-0.11.md)

## 本地开发与文档

```bash
git clone --recurse-submodules https://github.com/smartThise/OneTHU.git
cd OneTHU
git switch dev3
pnpm install
pnpm dev
```

`pnpm dev` 可在浏览器中快速预览和调试前端界面；若需体验校园网请求、本地文件、通知等完整系统能力，请配置 Rust 与 Tauri 环境运行原生宿主（Android 构建另需 JDK / SDK / NDK）。日常主力开发分支为 `dev3`。

- [开发者中心与构建指南](docs/developers.md)
- [OneTHU CLI、SDK 与常驻助理](docs/onethu-cli.md)：支持终端独立登录、课程资料归档、定时巡检、IM 提醒及面向外部智能体的 MCP 接入。
- [贡献者名录](docs/contributors.md)
- [插件开发指南](docs/plugin-development.md) · [API 清单](docs/api-surface.md) · [OneTHU Harness](https://github.com/smartThise/OneTHU-Harness)
- [系统架构](docs/architecture.md) · [OneGUI 设计系统](docs/design-language.md) · [文档目录索引](docs/documentation-catalog.md)

## 致谢与开源许可

衷心感谢 [THU Info](https://github.com/thu-info-community/thu-info-app)、[learnX](https://github.com/robertying/learnX)、[thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib)、[NextTHUxk](https://github.com/smartThise/NextTHUxk)、[NextTHULearn](https://github.com/smartThise/NextTHULearn)、thu-tok-auto、yuketang-helper-auto 以及每一位参与设计、开发、测试和反馈的朋友。

OneTHU 自有代码采用自定义非商业开源许可，并附带保护清华大学信息服务正常秩序的使用约定。若在公开项目中复用或改编相关代码，烦请在 README、NOTICE 等显著位置注明 OneTHU 及实际引用的上游项目。THU Info 授权代码、LearnX 移植部分及其他第三方依赖分别遵循各自许可条款。

[阅读完整许可](LICENSE) · [第三方组件许可与授权说明](LICENSES/THIRD-PARTY.md)

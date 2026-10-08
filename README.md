> 最后更新：2026-09-23 10:35

<div align="center">

<img src="docs/logo-banner.png" alt="(One / THU) — One THUer should have OneTHU." width="640"/>

**One THUer should have OneTHU.**

`One App · One Identity · One Campus`

[官网](https://onethu.github.io/)　·　[文档](https://onethu.github.io/docs/)　·　[下载最新版](https://github.com/smartThise/OneTHU/releases/latest)　·　[插件市场](https://onethu.github.io/market.html)

</div>

---

**One THU in OneTHU.**

OneTHU 是面向清华学生的校园应用：统一身份、统一数据、统一界面，覆盖 macOS / Windows / Android，
并内置 AI Agent（OneTHU Harness）。项目是对 thu-info-app / learnX / NextTHUxk 的整合重构。

## 为什么是 OneTHU

- **一个身份**：登录一次即可使用全部模块——网络学堂、信息门户、图书馆与校园卡共用同一次登录；
  登录状态过期后自动恢复，无需重新登录。
- **处处一致**：所有页面使用同一份数据与同一套界面、配色；同一个对象在各页面共用同一个原子。
- **一个对话入口**：内置 AI Agent，用一句话查询作业、课表、成绩、电费、图书馆预约与校园新闻。
- **数据可靠**：只读取校方公开接口；数据未取到时如实显示，不会提前标记为已提交。
- **全平台**：macOS / Windows / Android 功能对齐，通知、小组件与下载位置在三端均可用。

## 功能总览（0.10.0）

- **统一身份**：统一认证账号登录一次，全部模块共用登录状态，支持二次验证。
- **网络学堂**：课程、作业、通知、文件与讨论区集中管理；作业截止时间与提交状态与学校系统保持一致。
- **作业区**：网络学堂与外部作业源（雨课堂 / TUOJ / Tyche / DSA OJ）合并到「全部作业」与「今日」；
  支持忽略、附件拍照上传、必交附件预检，以及雨课堂主观题的应用内作答与提交。
- **信息门户**：个人信息 / 课表 / 成绩（中英文成绩单）/ 学年汇总 / 倒计时 / 新闻 / 校历 / 空教室 /
  教学评估 / 体测 / 卫生成绩。
- **日程与提醒**：课表、云日历与自定义日程合并为一条时间轴；提醒通过系统通知送达，支持静默时段。
- **生活服务**：校园卡流水、宿舍电费（充值）、校园网、电子发票、银行代发、研究生收入。
- **预约查询**：图书馆座位、研讨间、空教室、学生宿舍公共空间与体育场馆余量。
- **文件与下载**：课件、附件与云盘文件在应用内预览（Office / PDF / 图片 / 压缩包），并可选择保存位置。
- **原子化**：页面、组件与校园数据统一为「原子」，可搜索、可收藏、可通过链接直接打开，也可放置到桌面。
- **桌面小组件（Android）**：日程与截止任务、单个原子、收藏夹图标组与快捷方式，每块小组件可单独设置。
- **选课**：与 NextTHUxk 同源的教务选课查询系统。
- **插件与 Agent**：JS 插件、Rust 插件与 Android 内嵌三种形态；插件市场人工审查收录，一键安装。
- **OneTHU Harness**：内置 AI Agent，左下角常驻对话面板，可调用工具完成任务，并与插件双向联动。

## 下载与上手

安装包发布在 [Releases](https://github.com/smartThise/OneTHU/releases)：macOS DMG / Windows EXE /
Android APK；也可从 [官网](https://onethu.github.io/) 按平台获取。校内网络访问 GitHub 不畅时，使用
[清华云盘下载](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)（与 Releases 同一批文件，按系统分 Android / macOS / Windows 三个文件夹）。

1. 使用清华大学统一认证账号登录，支持二次验证；
2. 首启导览会依次引导界面定制、账号接入（雨课堂 / OJ / 邮箱日历 / 云盘）与桌面小组件，每步均可跳过；
3. 在「设置 → 通知」打开提醒、设置提前量与静默时段；数据异常时使用页面右下角的刷新按钮重试。

问题与建议请在 [Issues](https://github.com/smartThise/OneTHU/issues) 反馈，并附上应用版本与设置页的
自检结果。完整说明见 [在线文档](https://onethu.github.io/docs/)。

需要在不暴露真实姓名、学号与成绩的前提下演示界面时，使用 `demo` 分支构建的 **OneTHU Demo**
（脱敏演示版）：登录流程与正式版一致，姓名与学号替换为化名、成绩为编造成绩，课表、洗衣机、
教室等非敏感数据仍为真实数据；应用标识为 `app.onethu.demo`，可与正式版装在同一台设备上。
构建方式见 [脱敏演示版构建](docs/demo-build.md)。

## 使用边界与声明

- **体育场馆模块仅提供查询**（场馆 / 场次 / 余量 / 我的预约 / 退订），不提供应用内预约提交。**依据清华大学体育部场馆中心 2025 年 12 月 3 日发布的公告第七条第 12 款：如有用户通过脚本软件或插件等非正常途径预定场地，一经发现并核实，对该用户封禁预订权限 6 个月，并函告相关院系或单位。** 预约请通过应用内按钮前往官方网页完成。
- **严禁将本项目源码用于任何形式的自动预约 / 抢场**。该行为既违反体育部场馆中心预约须知，也违反本项目开源准则；由此产生的一切后果由使用者自行承担。
- 本项目为非官方的个人效率工具，与清华大学无关；所有数据均来自学校公开系统的网页接口，仅供个人学习与日常使用。

### 外部作业源（荷塘雨课堂 / TUOJ / Tyche / DSA OJ）

「设置 → 外部作业源」可将各平台的作业合并进「全部作业」与「今日」：

- **只读取**标题、课程、截止时间与状态，不代为提交，也不抓取题目内容。
- **登录方式**：雨课堂使用扫码或官方网页登录；TUOJ 与 Tyche 复用清华统一认证（TUOJ 也可配置独立账号）；
  DSA OJ 使用邮箱与密码（该站无统一认证）。登录成功后由应用从传输层取回登录凭据，无需手动复制 Cookie。
  应用内登录仅在桌面端可用，浏览器预览无法读取响应头。
- **凭据存储**：各平台凭据只以密文保存在本机（WebCrypto AES-GCM，密钥由本机随机盐与固定串派生）。
  ⚠️ **这属于本地混淆，不构成真正的安全防护**——密钥与密文同在本机，能读取本机存储的人仍可解出明文；
  它只避免凭据以可读形式被看到或随备份导出。请勿在共享设备上使用。
- **服务端地址固定写在代码中**（雨课堂、TUOJ、Tyche、DSA OJ 各自的校内或公网站点），不向用户暴露；
  Tyche 在校外网络需要 WebVPN。
- 各平台接口均为逆向自其网页端的非官方用法，可能随对方改版失效；外部源拉取失败不影响网络学堂主流程。

---

以下内容面向开发者。

## 快速开始

环境要求：Node ≥ 20、pnpm、Rust toolchain；Android 构建另需 Android SDK 与 NDK。

```bash
pnpm install      # 安装 workspace 全部依赖
```

### 日常开发

```bash
pnpm dev                                  # 浏览器预览（直连校园接口受同源策略限制）
pnpm --filter @onethu/desktop tauri:dev   # 原生桌面壳开发模式（前端热更新）
```

### 生产构建

```bash
pnpm build                                # 构建全部包；web 资产产出到 apps/desktop/dist
pnpm --filter @onethu/desktop tauri:build # 桌面安装包（macOS DMG / Windows EXE / Linux 包）

bash apps/desktop/scripts/build-release-apk.sh   # Android APK（发布线）
bash apps/desktop/scripts/build-demo-apk.sh      # Android APK（demo 线，脱敏演示版）
```

- 桌面产物：`apps/desktop/src-tauri/target/release/bundle/`
- Android 产物由上面的脚本输出到 `~/Desktop/OneTHU-builds`
- CI（`.github/workflows/release.yml`）在打 `v*` 标签时构建桌面安装包；sidecar 在目标平台现场构建，
  仓库不携带任何架构的二进制

### 分支约定

开发与发布都在 `dev3`（GitHub 与清华 Git 两个远端同步）；本地检出的分支名为 `dev2`，推送目标为
`dev3`。`demo` 分支用于脱敏演示版，两线只允许在少数文件上不同，镜像改动按文件摘取、不合并分支。

### 仓库结构

```
OneTHU/
├── packages/
│   ├── core/        @onethu/core      统一 API 客户端与数据层
│   ├── info-lib/    thu-info-lib 移植 信息门户数据层
│   └── ui/          @onethu/ui        设计令牌与基础样式
├── apps/
│   └── desktop/     @onethu/desktop   桌面端 + Android（Tauri 2，Vite + React）
├── plugins/
│   └── OneTHU-Harness/                官方骨干插件（Rust / Android 内嵌）
├── tools/                             测试与检查脚本、站点页面同步
└── docs/                              工程文档（在线文档站同步其正文）
```

### 文档与插件开发

工程文档的正文在 `docs/`，在线访问 <https://onethu.github.io/docs/>。
文档在标题下方带「最后更新」时间，改动后执行 `pnpm docs:stamp` 刷新；文案纪律执行 `pnpm lint:docs`。

插件支持 JS 插件、Rust 插件与 Android 内嵌三种形态，开放 30 个命名空间、133 个方法。
入门见 [插件开发指南](docs/plugin-development.md)，接口细节查 [API 参考](docs/api-reference.md)。

## OneTHU Harness（OH）

内置的校园 AI Agent：左下角常驻对话面板，覆盖作业、上课时间、图书馆预约、校园新闻等场景，
可与插件双向联动。详见 [plugins/OneTHU-Harness](https://github.com/smartThise/OneTHU-Harness)。

## 致谢

核心 API 结论分别验证自 [thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib)、
[thu-info-app](https://github.com/thu-info-community/thu-info-app)、[learnX](https://github.com/robertying/learnX)、
thu-tok-auto、yuketang-helper-auto，向以上项目的长期维护者致敬。

- **THU Info App / thu-info-lib**：数据层移植自上游，经 THU Info 团队**邮件授权**在非商业用途下
  二次分发（授权截止 **2036-12-31**，邮件原文存档于仓库）。
- **LearnX**：网络学堂子页与部分交互按其实现移植；其许可为 MIT **并附例外条件**（见下）。
- **thu-tok-auto**、**yuketang-helper-auto**（均为 MIT）：MadModel 与雨课堂侧的接口结论来源。

各项目的许可条件、授权范围与例外条款汇总在 [LICENSES/THIRD-PARTY.md](./LICENSES/THIRD-PARTY.md)。

## 许可

OneTHU 自有代码以 **MIT** 许可开源（见 [LICENSE](./LICENSE)），**并附两条限制**：

1. **严禁商业用途**；
2. **严禁用于对清华大学信息服务的攻击性访问**——包括编写或运行抢课、体育场馆/图书馆座位等
   自动预约提交的插件或脚本、高频批量请求、以及任何规避校方风控与身份校验的行为。

违反任一条，授权立即终止。第三方组件适用其自带许可，其中两点需特别注意：

| 来源 | 许可与限制 |
|---|---|
| [THU Info App / thu-info-lib](https://github.com/thu-info-community/thu-info-app) | 上游 BSL 1.1；THU Info 团队邮件授权 OneTHU **非商业用途**二次分发，**截止 2036-12-31** |
| [LearnX](https://github.com/robertying/learnX) | MIT，但**附带例外**：若您过去或现在任职清华大学信息化技术中心，或您的项目受任何与清华有关的机构资助，则未经授权的使用（含拷贝、修改、再分发，无论是否商用）视为侵权 |
| thu-tok-auto / yuketang-helper-auto | MIT |
| cheerio·iconv-lite·sm-crypto·mammoth·xlsx·katex 等 | 各自自带许可（MIT / Apache-2.0 等） |

完整条款见 [LICENSES/THIRD-PARTY.md](./LICENSES/THIRD-PARTY.md)。

## 版本

当前版本 **0.10.0**（详见 [Releases](https://github.com/smartThise/OneTHU/releases)）。

## 用户交流群

扫码加入 OneTHU 用户 QQ 群：反馈问题、提出需求、交流使用经验。

<p align="center">
  <img src="docs/qrcode_group.jpg" alt="OneTHU 用户 QQ 群" width="240"/>
</p>
